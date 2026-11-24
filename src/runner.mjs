import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir, killTree, sleep } from './util.mjs';
import { commitAll } from './git.mjs';

/**
 * Corre un agente Claude Code en modo headless (`claude -p`) dentro de `cwd`.
 * Cada etapa es una sesión nueva con contexto limpio: el verificador nunca "recuerda"
 * haber escrito el código que revisa.
 *
 * `onEvent(ev)` recibe la actividad en vivo: { kind: 'tool'|'text'|'info', text }.
 * Devuelve { ok, limited, text, costUsd, sessionId, turns }.
 */
export async function runAgent(opts) {
  if (process.env.FLEET_RUNNER === 'fake') return runFake(opts);
  return runClaude(opts);
}

/** Resume una llamada a herramienta para mostrarla en la actividad en vivo. */
export function describeTool(name, input = {}) {
  const target = input.file_path || input.command || input.pattern || input.path || input.url || input.description || '';
  const short = String(target).replace(/\s+/g, ' ').slice(0, 160);
  return short ? `${name}: ${short}` : name;
}

/** Convierte una línea de `--output-format stream-json` en eventos de actividad. */
export function streamLineToEvents(msg) {
  if (msg?.type !== 'assistant') return [];
  const content = msg.message?.content || [];
  return content.flatMap((c) => {
    if (c.type === 'tool_use') return [{ kind: 'tool', text: describeTool(c.name, c.input) }];
    if (c.type === 'text' && c.text?.trim()) return [{ kind: 'text', text: c.text.trim().slice(0, 400) }];
    return [];
  });
}

function runClaude({ cfg, cwd, prompt, model, maxTurns, readOnly = false, logFile, onEvent }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--max-turns', String(maxTurns)];
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
    let raw = '';
    let buffer = '';
    let stderr = '';
    let result = null;
    const handleLine = (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === 'result') result = msg;
      for (const ev of streamLineToEvents(msg)) {
        try { onEvent?.(ev); } catch { /* la UI no debe romper al agente */ }
      }
    };
    child.stdout.on('data', (d) => {
      const s = d.toString();
      raw += s;
      buffer += s;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handleLine);
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { stderr += '\n[fleet] timeout de etapa'; killTree(child); }, cfg.stageTimeoutMin * 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `No se pudo lanzar "${cfg.claudeCommand}": ${e.message}`, costUsd: 0 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      handleLine(buffer);
      if (logFile) {
        ensureDir(path.dirname(logFile));
        fs.writeFileSync(logFile, `# exit ${code}\n## stdout (stream-json)\n${raw}\n## stderr\n${stderr}\n`);
      }
      if (!result) {
        const text = `Salida inesperada de claude (exit ${code}):\n${stderr || raw.slice(-3000)}`.slice(0, 4000);
        resolve({ ok: false, limited: isUsageLimit(text), text, costUsd: 0 });
        return;
      }
      const ok = code === 0 && !result.is_error;
      resolve({
        ok,
        limited: !ok && isUsageLimit(`${result.result ?? ''} ${stderr}`),
        text: result.result ?? '',
        // Con el plan no se cobra: es el costo EQUIVALENTE que informa Claude Code, solo como referencia.
        costUsd: Number(result.total_cost_usd) || 0,
        sessionId: result.session_id,
        turns: result.num_turns,
        subtype: result.subtype,
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
 * FLEET_FAKE_DELAY_MS agrega una pausa por etapa, para ver el movimiento en Studio.
 */
async function runFake({ cwd, stage, taskId, logFile, onEvent }) {
  const delay = Number(process.env.FLEET_FAKE_DELAY_MS) || 0;
  if (process.env.FLEET_FAKE_FAIL === 'limit') {
    return { ok: false, limited: true, text: 'Claude AI usage limit reached (simulado)', costUsd: 0 };
  }
  onEvent?.({ kind: 'tool', text: 'Read: README.md' });
  if (delay) await sleep(delay / 2);
  onEvent?.({ kind: 'text', text: `Trabajando en la etapa ${stage} (simulado)` });
  if (delay) await sleep(delay / 2);
  const fail = process.env.FLEET_FAKE_FAIL === stage;
  let text;
  if (stage === 'propose') {
    const props = [
      { title: 'Agregar tests de total() con varios productos y descuento', category: 'test', risk: 'low', priority: 2, area: 'carrito', rationale: 'total() no tiene tests con descuento (simulado)', description: 'Cubrir total() con 2+ productos y 10% de descuento.', acceptance: ['Test nuevo que pasa', 'npm test pasa'], source: 'código' },
      { title: 'Mostrar mensaje cuando el carrito está vacío', category: 'feature', risk: 'medium', priority: 3, area: 'carrito', rationale: 'Pedido en el feedback (simulado)', description: 'Devolver un mensaje claro cuando no hay productos.', acceptance: ['Mensaje visible con carrito vacío'], source: 'feedback' },
    ];
    const fence = '```';
    text = `Analicé el proyecto (simulado).\n${fence}json\n${JSON.stringify(props)}\n${fence}`;
  } else if (stage === 'plan') {
    text = `## Objetivo\nPlan simulado para la tarea ${taskId}.\n## Pasos\n1. Crear archivo\n2. Verificar`;
  } else if (stage === 'execute') {
    if (fail) return { ok: false, text: 'fallo simulado en execute', costUsd: 0.01 };
    fs.writeFileSync(path.join(cwd, `fleet-fake-${taskId}.txt`), `trabajo de la tarea ${taskId}\n`);
    commitAll(cwd, `feat: tarea ${taskId} (fake)`);
    onEvent?.({ kind: 'tool', text: `Bash: git commit -m "feat: tarea ${taskId}"` });
    text = 'Listo. Creé el archivo y lo commiteé.';
  } else if (stage === 'verify' || stage === 'review') {
    const verdict = fail ? 'fail' : 'pass';
    text = `Revisé todo.\n\`\`\`json\n${JSON.stringify({ verdict, evidence: ['fake: check ok'], problems: fail ? ['problema simulado'] : [] })}\n\`\`\``;
  } else {
    text = `## Reporte simulado (${stage})\nSin hallazgos.`;
  }
  if (logFile) { ensureDir(path.dirname(logFile)); fs.writeFileSync(logFile, text); }
  return { ok: true, text, costUsd: 0.01, sessionId: 'fake', turns: 1 };
}
