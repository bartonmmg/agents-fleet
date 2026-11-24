import fs from 'node:fs';
import path from 'node:path';
import { fleetDir } from './config.mjs';
import { runAgent } from './runner.mjs';
import { commitAll, commitsAhead, createWorktree, diffLines, isDirty } from './git.mjs';
import { ROLES, executePrompt, pickReviewFocus, planPrompt, reviewPrompt, verifyPrompt } from './prompts.mjs';
import { extractJson, log, runShell, tail } from './util.mjs';

/** Se alcanzó el tope diario de ejecuciones configurado (maxAgentRunsPerDay). */
export class DailyRunLimit extends Error {}
/** El plan de Claude llegó a su límite de uso: se pausa, no es culpa de la tarea. */
export class PlanUsageLimit extends Error {}
export class StopRequested extends Error {}
/** Errores que pausan la flota y devuelven la tarea a la cola en vez de marcarla como fallida. */
export const isPause = (e) => e instanceof DailyRunLimit || e instanceof PlanUsageLimit || e instanceof StopRequested;

export const stopFile = (repo) => path.join(fleetDir(repo), 'STOP');

/**
 * Lleva una tarea por: plan → execute → check determinístico → verify → review adversarial.
 * Si algo falla, el feedback vuelve al worker (hasta maxAttempts). Devuelve el estado final.
 */
export async function processTask(ctx, taskId) {
  const { repo, cfg, store } = ctx;
  let task = store.get(taskId);
  const base = cfg.baseBranch;
  const runDir = path.join(fleetDir(repo), 'runs', `task-${taskId}`);

  const { branch, wt } = createWorktree(repo, taskId, base);
  task = store.update(taskId, { status: 'running', branch, worktree: wt }, `worktree ${wt}`);

  const stage = async (name, prompt, { readOnly = false, model = cfg.models[name], tag = name } = {}) => {
    if (fs.existsSync(stopFile(repo))) throw new StopRequested('stop solicitado');
    if (store.runsToday() >= cfg.maxAgentRunsPerDay) throw new DailyRunLimit(`tope diario de ${cfg.maxAgentRunsPerDay} ejecuciones de agentes alcanzado`);
    store.update(taskId, { stage: tag });
    log(`#${taskId} ▶ ${ROLES[name].name}: ${tag}`);
    const res = await runAgent({
      cfg, cwd: wt, prompt, model, readOnly, stage: name, taskId,
      maxTurns: cfg.maxTurns[name],
      logFile: path.join(runDir, `${tag}-${Date.now()}.log`),
    });
    store.addRun(taskId, tag, res.costUsd);
    if (res.limited) throw new PlanUsageLimit('el plan de Claude alcanzó su límite de uso');
    return res;
  };

  try {
    // 1. Plan (una sola vez por tarea; se reutiliza en los reintentos)
    if (!task.plan) {
      const plan = await stage('plan', planPrompt(cfg, task), { readOnly: true });
      if (!plan.ok) return fail(ctx, taskId, `El Tech Lead falló al planificar: ${tail(plan.text, 1500)}`);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'plan.md'), plan.text);
      task = store.update(taskId, { plan: plan.text }, 'plan listo');
    }

    let feedback = task.feedback;
    for (let attempt = task.attempts + 1; attempt <= cfg.maxAttempts; attempt++) {
      task = store.update(taskId, { attempts: attempt }, `intento ${attempt}`);

      // 2. Execute
      const exec = await stage('execute', executePrompt(cfg, task, feedback), { tag: `execute-${attempt}` });
      if (!exec.ok) { feedback = `La ejecución terminó con error:\n${tail(exec.text, 2000)}`; continue; }
      if (isDirty(wt)) commitAll(wt, `chore(fleet): cambios sin commitear de la tarea #${taskId}`);
      if (commitsAhead(wt, base) === 0) { feedback = 'No hay commits nuevos en la rama: la tarea no se implementó.'; continue; }

      // 3. Check determinístico: Fleet no confía en que el agente lo haya corrido.
      let checkOut = '';
      if (cfg.checkCommand) {
        store.update(taskId, { stage: `check-${attempt}` });
        log(`#${taskId} ▶ check: ${cfg.checkCommand}`);
        const check = await runShell(cfg.checkCommand, wt, cfg.checkTimeoutMin * 60_000);
        checkOut = tail(check.output, 1500);
        if (!check.ok) { feedback = `El comando de verificación \`${cfg.checkCommand}\` FALLÓ:\n${tail(check.output, 3000)}`; continue; }
      }

      // 4. Verificador independiente (sesión nueva, sin permisos de edición)
      const ver = await stage('verify', verifyPrompt(cfg, task, checkOut), { readOnly: true, tag: `verify-${attempt}` });
      const vVerdict = extractJson(ver.text);
      store.update(taskId, { verdicts: { ...store.get(taskId).verdicts, verify: vVerdict } });
      if (!ver.ok || vVerdict?.verdict !== 'pass') {
        feedback = `El QA Verifier RECHAZÓ el trabajo:\n${JSON.stringify(vVerdict?.problems ?? tail(ver.text, 2000), null, 2)}`;
        continue;
      }

      // 5. Code Review adversarial: 1-3 enfoques según el tamaño del diff, en paralelo.
      const focuses = pickReviewFocus(diffLines(wt, base));
      const reviews = await Promise.all(focuses.map((focus) =>
        stage('review', reviewPrompt(cfg, task, focus), { readOnly: true, tag: `review-${focus.id}-${attempt}` })
          .then((r) => ({ focus: focus.name, ok: r.ok, verdict: extractJson(r.text), text: r.text }))));
      store.update(taskId, { verdicts: { ...store.get(taskId).verdicts, review: reviews.map(({ focus, verdict }) => ({ focus, ...verdict })) } });
      const rejected = reviews.filter((r) => !r.ok || r.verdict?.verdict !== 'pass');
      if (rejected.length) {
        feedback = rejected.map((r) => `Code Reviewer (${r.focus}) RECHAZÓ:\n${JSON.stringify(r.verdict?.problems ?? tail(r.text, 1500), null, 2)}`).join('\n\n');
        continue;
      }

      store.update(taskId, { status: 'ready_to_merge', stage: null, feedback: null, error: null }, 'verificada y revisada: lista para merge');
      log(`#${taskId} ✔ lista para merge`);
      return 'ready_to_merge';
    }
    return fail(ctx, taskId, feedback || 'Se agotaron los intentos');
  } catch (err) {
    if (isPause(err)) {
      store.update(taskId, { status: 'queued', stage: null }, `pausada: ${err.message}`);
      throw err;
    }
    return fail(ctx, taskId, `Error interno: ${err.message}`);
  }
}

function fail(ctx, taskId, reason) {
  ctx.store.update(taskId, { status: 'needs_human', stage: null, error: reason, feedback: reason }, 'necesita revisión humana');
  log(`#${taskId} ✖ necesita revisión humana`);
  return 'needs_human';
}
