import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir, killTree } from './util.mjs';
import { commitAll } from './git.mjs';

/**
 * Corre un agente Claude Code en modo headless (`claude -p`) dentro de `cwd`.
 * Cada etapa es una sesión nueva con contexto limpio: el verificador nunca "recuerda"
 * haber escrito el código que revisa.
 *
 * Devuelve { ok, text, costUsd, sessionId, turns }.
 */
export async function runAgent(opts) {
  if (process.env.FLEET_RUNNER === 'fake') return runFake(opts);
  return runClaude(opts);
}

function runClaude({ cfg, cwd, prompt, model, maxTurns, readOnly = false, logFile }) {
  const args = ['-p', '--output-format', 'json', '--model', model, '--max-turns', String(maxTurns)];
  if (readOnly) {
    args.push('--permission-mode', 'default', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  } else {
    args.push('--permission-mode', cfg.permissionMode);
  }
  args.push('--allowedTools', ...cfg.allowedTools.filter((t) => !(readOnly && (t === 'Edit' || t === 'Write'))));

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cfg.claudeCommand, args, { cwd, windowsHide: true, env: agentEnv(cfg) });
    } catch (e) {
      resolve({ ok: false, text: `No se pudo lanzar "${cfg.claudeCommand}": ${e.message}`, costUsd: 0 });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { stderr += '\n[fleet] timeout de etapa'; killTree(child); }, cfg.stageTimeoutMin * 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `No se pudo lanzar "${cfg.claudeCommand}": ${e.message}`, costUsd: 0 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (logFile) {
        ensureDir(path.dirname(logFile));
        fs.writeFileSync(logFile, `# exit ${code}\n## stdout\n${stdout}\n## stderr\n${stderr}\n`);
      }
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { /* salida no JSON */ }
      if (!parsed) {
        const text = `Salida inesperada de claude (exit ${code}):\n${stderr || stdout}`.slice(0, 4000);
        resolve({ ok: false, limited: isUsageLimit(text), text, costUsd: 0 });
        return;
      }
      const ok = code === 0 && !parsed.is_error;
      resolve({
        ok,
        limited: !ok && isUsageLimit(`${parsed.result ?? ''} ${stderr}`),
        text: parsed.result ?? '',
        // Con el plan no se cobra: es el costo EQUIVALENTE que informa Claude Code, solo como referencia.
        costUsd: Number(parsed.total_cost_usd) || 0,
        sessionId: parsed.session_id,
        turns: parsed.num_turns,
        subtype: parsed.subtype,
      });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Entorno del agente. En modo planOnly se quitan las credenciales de API: Claude Code usa tu login del plan. */
export function agentEnv(cfg, base = process.env) {
  const env = { ...base, FLEET_AGENT: '1' };
  if (cfg.planOnly !== false) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

/** ¿El error es porque el plan llegó a su límite de uso (o hay saturación temporal)? */
export function isUsageLimit(text) {
  return /usage limit|limit reached|rate.?limit|hit your limit|429|overloaded|quota/i.test(text || '');
}

/**
 * Runner falso para tests y demos sin gastar tokens.
 * FLEET_FAKE_FAIL=verify|review|execute hace fallar esa etapa; FLEET_FAKE_FAIL=limit simula el límite del plan.
 */
async function runFake({ cwd, stage, taskId, logFile }) {
  if (process.env.FLEET_FAKE_FAIL === 'limit') {
    return { ok: false, limited: true, text: 'Claude AI usage limit reached (simulado)', costUsd: 0 };
  }
  const fail = process.env.FLEET_FAKE_FAIL === stage;
  let text;
  if (stage === 'plan') {
    text = `Plan falso para la tarea ${taskId}:\n1. Crear archivo\n2. Verificar`;
  } else if (stage === 'execute') {
    if (fail) return { ok: false, text: 'fallo simulado en execute', costUsd: 0.01 };
    fs.writeFileSync(path.join(cwd, `fleet-fake-${taskId}.txt`), `trabajo de la tarea ${taskId}\n`);
    commitAll(cwd, `feat: tarea ${taskId} (fake)`);
    text = 'Listo. Creé el archivo y lo commiteé.';
  } else if (stage === 'verify' || stage === 'review') {
    const verdict = fail ? 'fail' : 'pass';
    text = `Revisé todo.\n\`\`\`json\n${JSON.stringify({ verdict, evidence: ['fake: check ok'], problems: fail ? ['problema simulado'] : [] })}\n\`\`\``;
  } else {
    text = `## Reporte falso (${stage})\nSin hallazgos.`;
  }
  if (logFile) { ensureDir(path.dirname(logFile)); fs.writeFileSync(logFile, text); }
  return { ok: true, text, costUsd: 0.01, sessionId: 'fake', turns: 1 };
}
