import fs from 'node:fs';
import path from 'node:path';
import { fleetDir } from './config.mjs';
import { runAgent } from './runner.mjs';
import { branchDiff, commitAll, commitsAhead, createWorktree, diffLines, isDirty, shortStat } from './git.mjs';
import { ROLES, executePrompt, pickReviewFocus, planPrompt, reviewPrompt, verifyPrompt } from './prompts.mjs';
import { extractJson, log, now, runShell, tail } from './util.mjs';

/** Se alcanzó el tope diario de ejecuciones configurado (maxAgentRunsPerDay). */
export class DailyRunLimit extends Error {}
/** El plan de Claude llegó a su límite de uso: se pausa, no es culpa de la tarea. */
export class PlanUsageLimit extends Error {}
export class StopRequested extends Error {}
/** Errores que pausan la flota y devuelven la tarea a la cola en vez de marcarla como fallida. */
export const isPause = (e) => e instanceof DailyRunLimit || e instanceof PlanUsageLimit || e instanceof StopRequested;

export const stopFile = (repo) => path.join(fleetDir(repo), 'STOP');
export const runDirOf = (repo, taskId) => path.join(fleetDir(repo), 'runs', `task-${taskId}`);
export const activityFile = (repo, taskId) => path.join(runDirOf(repo, taskId), 'activity.jsonl');

/** Resumen legible de la salida de tests (node:test, Jest/Vitest, pytest); si no lo reconoce, las últimas líneas. */
export function summarizeCheck(output, ok) {
  const out = String(output || '');
  const node = { pass: out.match(/^# pass (\d+)/m)?.[1], fail: out.match(/^# fail (\d+)/m)?.[1] };
  if (node.pass !== undefined) {
    const total = Number(node.pass) + Number(node.fail || 0);
    return ok ? `${node.pass} de ${total} tests pasaron` : `${node.fail} de ${total} tests fallaron\n${tail(out, 500)}`;
  }
  const jest = out.match(/Tests:\s+(.*)/)?.[1] || out.match(/=+ (.*(passed|failed).*) =+/)?.[1];
  if (jest) return ok ? `Tests: ${jest.trim()}` : `Tests: ${jest.trim()}\n${tail(out, 500)}`;
  return ok ? 'El comando de verificación pasó' : tail(out, 700);
}

const firstLines = (text, n = 6) => String(text || '').split('\n').filter((l) => l.trim()).slice(0, n).join('\n');
const list = (arr) => (Array.isArray(arr) ? arr.join(' · ') : String(arr || ''));

/**
 * Lleva una tarea por: Tech Lead (plan) → Developer (execute) → check determinístico
 * → QA Verifier (verify) → Code Reviewer (review, 1-3 enfoques).
 * Si algo falla, el feedback vuelve al Developer (hasta maxAttempts). Devuelve el estado final.
 * Cada etapa queda registrada como un "paso" visible (task.steps) y su actividad en vivo
 * se emite por ctx.onActivity y se guarda en .fleet/runs/task-N/activity.jsonl.
 */
export async function processTask(ctx, taskId) {
  const { repo, cfg, store } = ctx;
  let task = store.get(taskId);
  const base = cfg.baseBranch;
  const runDir = runDirOf(repo, taskId);
  fs.mkdirSync(runDir, { recursive: true });

  const { branch, wt } = createWorktree(repo, taskId, base);
  task = store.update(taskId, { status: 'running', branch, worktree: wt }, `worktree ${wt}`);

  const activity = (stageTag, role, ev) => {
    const entry = { taskId, stage: stageTag, role, at: now(), ...ev };
    try { fs.appendFileSync(activityFile(repo, taskId), `${JSON.stringify(entry)}\n`); } catch { /* no crítico */ }
    try { ctx.onActivity?.(entry); } catch { /* no crítico */ }
  };

  const stage = async (name, prompt, { readOnly = false, model = cfg.models[name], tag = name } = {}) => {
    if (fs.existsSync(stopFile(repo))) throw new StopRequested('stop solicitado');
    if (store.runsToday() >= cfg.maxAgentRunsPerDay) throw new DailyRunLimit(`tope diario de ${cfg.maxAgentRunsPerDay} ejecuciones de agentes alcanzado`);
    const role = ROLES[name].name;
    store.update(taskId, { stage: tag });
    store.startStep(taskId, { key: tag, role, stage: name });
    log(`#${taskId} ▶ ${role}: ${tag}`);
    activity(tag, role, { kind: 'info', text: `${role} empezó` });
    const res = await runAgent({
      cfg, cwd: wt, prompt, model, readOnly, stage: name, taskId,
      maxTurns: cfg.maxTurns[name],
      logFile: path.join(runDir, `${tag}-${Date.now()}.log`),
      onEvent: (ev) => activity(tag, role, ev),
    });
    store.addRun(taskId, tag, res.costUsd);
    if (res.limited) {
      store.finishStep(taskId, tag, { status: 'paused', summary: 'Se alcanzó el límite de uso del plan' });
      throw new PlanUsageLimit('el plan de Claude alcanzó su límite de uso');
    }
    return res;
  };
  const finish = (tag, ok, summary) => store.finishStep(taskId, tag, { status: ok ? 'ok' : 'fail', summary });

  try {
    // 1. Tech Lead: plan (una sola vez por tarea; se reutiliza en los reintentos)
    if (!task.plan) {
      const plan = await stage('plan', planPrompt(cfg, task), { readOnly: true });
      finish('plan', plan.ok, plan.ok ? firstLines(plan.text) : tail(plan.text, 600));
      if (!plan.ok) return fail(ctx, taskId, `El Tech Lead falló al planificar: ${tail(plan.text, 1500)}`);
      fs.writeFileSync(path.join(runDir, 'plan.md'), plan.text);
      task = store.update(taskId, { plan: plan.text }, 'plan listo');
    }

    let feedback = task.feedback;
    for (let attempt = task.attempts + 1; attempt <= cfg.maxAttempts; attempt++) {
      task = store.update(taskId, { attempts: attempt }, `intento ${attempt}`);

      // 2. Developer
      const execTag = `execute-${attempt}`;
      const exec = await stage('execute', executePrompt(cfg, task, feedback), { tag: execTag });
      if (!exec.ok) {
        finish(execTag, false, tail(exec.text, 600));
        feedback = `La ejecución terminó con error:\n${tail(exec.text, 2000)}`;
        continue;
      }
      if (isDirty(wt)) commitAll(wt, `chore(fleet): cambios sin commitear de la tarea #${taskId}`);
      if (commitsAhead(wt, base) === 0) {
        finish(execTag, false, 'No hizo commits: la tarea no se implementó');
        feedback = 'No hay commits nuevos en la rama: la tarea no se implementó.';
        continue;
      }
      finish(execTag, true, `${shortStat(wt, base)}\n${tail(exec.text, 500)}`);

      // 3. Check determinístico: Fleet no confía en que el agente lo haya corrido.
      let checkOut = '';
      if (cfg.checkCommand) {
        const checkTag = `check-${attempt}`;
        store.update(taskId, { stage: checkTag });
        store.startStep(taskId, { key: checkTag, role: 'Tests', stage: 'check' });
        log(`#${taskId} ▶ check: ${cfg.checkCommand}`);
        activity(checkTag, 'Tests', { kind: 'tool', text: `Bash: ${cfg.checkCommand}` });
        const check = await runShell(cfg.checkCommand, wt, cfg.checkTimeoutMin * 60_000);
        checkOut = tail(check.output, 1500);
        finish(checkTag, check.ok, summarizeCheck(check.output, check.ok));
        if (!check.ok) { feedback = `El comando de verificación \`${cfg.checkCommand}\` FALLÓ:\n${tail(check.output, 3000)}`; continue; }
      }

      // 4. QA Verifier independiente (sesión nueva, sin permisos de edición)
      const verTag = `verify-${attempt}`;
      const ver = await stage('verify', verifyPrompt(cfg, task, checkOut), { readOnly: true, tag: verTag });
      const vVerdict = extractJson(ver.text);
      store.update(taskId, { verdicts: { ...store.get(taskId).verdicts, verify: vVerdict } });
      saveEvidence(wt, runDir);
      const verOk = ver.ok && vVerdict?.verdict === 'pass';
      finish(verTag, verOk, verOk ? list(vVerdict?.evidence) : list(vVerdict?.problems) || tail(ver.text, 600));
      if (!verOk) {
        feedback = `El QA Verifier RECHAZÓ el trabajo:\n${JSON.stringify(vVerdict?.problems ?? tail(ver.text, 2000), null, 2)}`;
        continue;
      }

      // 5. Code Reviewer adversarial: 1-3 enfoques según el tamaño del diff, en paralelo.
      const focuses = pickReviewFocus(diffLines(wt, base));
      const reviews = await Promise.all(focuses.map((focus) => {
        const tag = `review-${focus.id}-${attempt}`;
        return stage('review', reviewPrompt(cfg, task, focus), { readOnly: true, tag }).then((r) => {
          const verdict = extractJson(r.text);
          const ok = r.ok && verdict?.verdict === 'pass';
          const nits = verdict?.nits?.length ? `Sugerencias: ${list(verdict.nits)}` : 'Sin problemas';
          finish(tag, ok, `${focus.name}: ${ok ? nits : list(verdict?.problems) || tail(r.text, 500)}`);
          return { focus: focus.name, ok, verdict, text: r.text };
        });
      }));
      store.update(taskId, { verdicts: { ...store.get(taskId).verdicts, review: reviews.map(({ focus, verdict }) => ({ focus, ...verdict })) } });
      const rejected = reviews.filter((r) => !r.ok);
      if (rejected.length) {
        feedback = rejected.map((r) => `Code Reviewer (${r.focus}) RECHAZÓ:\n${JSON.stringify(r.verdict?.problems ?? tail(r.text, 1500), null, 2)}`).join('\n\n');
        continue;
      }

      try { fs.writeFileSync(path.join(runDir, 'changes.diff'), branchDiff(repo, base, branch)); } catch { /* no crítico */ }
      store.update(taskId, { status: 'ready_to_merge', stage: null, feedback: null, error: null }, 'verificada y revisada: lista para integrar');
      log(`#${taskId} ✔ lista para integrar`);
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

/** Copia la evidencia del QA (screenshots, logs) fuera del worktree, para que sobreviva al merge. */
function saveEvidence(wt, runDir) {
  const src = path.join(wt, '.fleet-evidence');
  if (!fs.existsSync(src)) return;
  try { fs.cpSync(src, path.join(runDir, 'evidence'), { recursive: true }); } catch { /* no crítico */ }
}

function fail(ctx, taskId, reason) {
  ctx.store.update(taskId, { status: 'needs_human', stage: null, error: reason, feedback: reason }, 'necesita revisión humana');
  log(`#${taskId} ✖ necesita revisión humana`);
  return 'needs_human';
}
