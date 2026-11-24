import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { applyGitIdentity, loadConfig, saveConfig } from './config.mjs';
import { Store } from './store.mjs';
import { initRepo } from './init.mjs';
import { runFleet } from './scheduler.mjs';
import { mergeTask } from './merge.mjs';
import { stopFile } from './pipeline.mjs';
import { removeWorktree, repoRoot } from './git.mjs';
import { writeReport } from './report.mjs';
import { startDashboard } from './dashboard.mjs';
import { importGithub, importTodosFile } from './ingest.mjs';
import { runAudit } from './audit.mjs';
import { acceptProposals, declineProposal, runProposals } from './propose.mjs';

const HELP = `fleet — flota de agentes Claude Code (verificación primero, worktrees, review adversarial)

Roles: Tech Lead (planifica) → Developer (implementa) → QA Verifier (prueba) → Code Reviewer (revisa)
       Auditor de calidad (fleet audit) · Usa solo tu plan de Claude: nunca factura por API.

Uso: fleet <comando> [opciones] [--repo <ruta>]   (por defecto, el repo del directorio actual)

  studio [--port 4400] [--no-open] [--repo <ruta>]   Interfaz visual (recomendado). También: doble clic en "Fleet Studio.cmd"
  autopilot [--repo <ruta>]                          Autopilot nocturno sin interfaz (dejá la terminal abierta)
  init [--check "<cmd>"] [--mode supervised|auto]   Prepara el repo: .fleet/, skills y agentes plantilla
  add "<título>" [--desc ..] [--area ..] [--priority 1|2|3]
  import <todos.md> | --github [--label fleet]       Carga tareas desde un checklist o issues de GitHub
  propose [--max N]                                  Product Manager: propone tareas (quedan como propuestas)
  accept <id> | --all                                Aprueba propuestas: pasan a la cola
  decline <id> [--reason "..."]                      Descarta una propuesta (el motivo se recuerda)
  list [--status <estado>]                           Lista tareas
  show <id>                                          Detalle, veredictos e historial
  run [--once] [--watch] [--max N]                   Lanza la flota (watch = modo nocturno)
  merge <id> | --all                                 Integra tareas listas (rebase + check + ff)
  retry <id>                                         Vuelve a encolar una tarea (conserva el plan)
  cancel <id>                                        Cancela y borra su worktree
  stop | resume                                      Kill switch: frena/permite lanzar agentes
  report [--hours 24]                                Informe matutino en .fleet/reports/
  audit [--days 7]                                   Auditor de calidad: malas prácticas repetidas y reglas a crear
  dashboard [--port 4400]                            Tablero web local
  config [clave] [valor]                             Ver o cambiar la configuración
`;

export async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      repo: { type: 'string' }, check: { type: 'string' }, mode: { type: 'string' },
      desc: { type: 'string' }, area: { type: 'string' }, priority: { type: 'string' },
      status: { type: 'string' }, once: { type: 'boolean' }, watch: { type: 'boolean' },
      max: { type: 'string' }, all: { type: 'boolean' }, hours: { type: 'string' },
      days: { type: 'string' }, port: { type: 'string' }, github: { type: 'boolean' },
      label: { type: 'string' }, reason: { type: 'string' }, help: { type: 'boolean', short: 'h' }, 'no-open': { type: 'boolean' },
    },
  });
  const [cmd, ...args] = positionals;
  if (!cmd || o.help || cmd === 'help') { console.log(HELP); return; }

  const startDir = path.resolve(o.repo || process.cwd());

  if (cmd === 'studio') {
    const { startStudio } = await import('./studio/index.mjs');
    await startStudio({ port: Number(o.port) || 4400, open: !o['no-open'], project: o.repo ? startDir : undefined });
    await new Promise(() => {});
  }

  if (cmd === 'autopilot') {
    const { Engine } = await import('./studio/engine.mjs');
    const { FLEET_ROOT } = await import('./studio/index.mjs');
    const engine = new Engine({ home: path.join(FLEET_ROOT, '.studio') });
    const r = engine.open(startDir);
    if (r.needsInit) throw new Error('El proyecto no está preparado: corré `fleet init` o abrilo en Studio.');
    const { schedule, mode } = engine.ctx.cfg;
    if (!schedule.enabled) console.log('ℹ El horario nocturno está desactivado: activalo desde Studio (Configuración → Autopilot).');
    console.log(`Autopilot esperando la ventana ${schedule.window} · modo ${mode}. Dejá esta ventana abierta (Ctrl+C para salir).`);
    await engine.startAutopilotTimer();
    await new Promise(() => {});
  }

  if (cmd === 'init') {
    const { repo, created, ignored } = initRepo(startDir, { check: o.check, mode: o.mode });
    console.log(`✔ Fleet inicializado en ${repo}`);
    created.forEach((f) => console.log(`  + ${path.relative(repo, f)}`));
    if (ignored.length) console.log(`  + .gitignore: ${ignored.join(', ')}`);
    const cfg = loadConfig(repo);
    console.log(`\nRama base: ${cfg.baseBranch} · modo: ${cfg.mode} · check: ${cfg.checkCommand || '(ninguno — definilo con: fleet config checkCommand "npm test")'}`);
    console.log('Siguiente: completá .claude/skills/fleet-verify/SKILL.md con cómo se prueba TU app, y agregá tareas con `fleet add`.');
    return;
  }

  const repo = repoRoot(startDir);
  const cfg = loadConfig(repo);
  applyGitIdentity(cfg);
  const store = new Store(repo);
  const ctx = { repo, cfg, store };

  switch (cmd) {
    case 'add': {
      if (!args[0]) throw new Error('Falta el título: fleet add "Título de la tarea"');
      const t = store.add({ title: args.join(' '), description: o.desc || '', area: o.area || null, priority: o.priority || 2 });
      console.log(`✔ Tarea #${t.id} encolada`);
      break;
    }
    case 'import': {
      const added = o.github ? importGithub(store, repo, o.label || 'fleet') : importTodosFile(store, path.resolve(args[0] || 'todos.md'));
      console.log(`✔ ${added.length} tareas nuevas importadas`);
      added.forEach((t) => console.log(`  #${t.id} ${t.title}`));
      break;
    }
    case 'list': {
      const tasks = store.all().filter((t) => !o.status || t.status === o.status);
      if (!tasks.length) { console.log('Sin tareas.'); break; }
      for (const t of tasks) {
        console.log(`#${String(t.id).padEnd(4)} ${t.status.padEnd(15)} P${t.priority} ${(t.area || '-').padEnd(12)} ${t.title}${t.stage ? `  [${t.stage}]` : ''}`);
      }
      console.log(`\nEjecuciones de agentes hoy: ${store.runsToday()} / ${cfg.maxAgentRunsPerDay} (usa tu plan, sin costo extra)`);
      break;
    }
    case 'show': {
      const t = store.get(args[0]);
      console.log(JSON.stringify({ ...t, plan: t.plan ? `${t.plan.slice(0, 1500)}…` : null }, null, 2));
      break;
    }
    case 'propose': {
      const r = await runProposals(ctx, { max: o.max });
      console.log(r.ok ? `✔ ${r.message}` : `✖ ${r.message}`);
      r.added.forEach((t) => console.log(`  #${t.id} [${t.category} · riesgo ${t.risk}] ${t.title}`));
      if (r.added.length) console.log('\nAprobá con: fleet accept <id>  (o --all)  ·  descartá con: fleet decline <id> --reason "..."');
      break;
    }
    case 'accept': {
      const ids = o.all ? store.all().filter((t) => t.status === 'proposed').map((t) => t.id) : args.map(Number);
      console.log(`✔ ${acceptProposals(store, ids).length} propuestas aprobadas`);
      break;
    }
    case 'decline':
      declineProposal(store, args[0], o.reason);
      console.log(`✔ #${args[0]} descartada`);
      break;
    case 'run':
      if (cfg.planOnly !== false && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
        console.log('ℹ Hay una API key en el entorno: Fleet NO la pasa a los agentes (planOnly). Se usará tu login del plan.');
      }
      await runFleet(ctx, { once: o.once, watch: o.watch, max: o.max });
      break;
    case 'merge': {
      const ids = o.all ? store.all().filter((t) => t.status === 'ready_to_merge').map((t) => t.id) : [Number(args[0])];
      if (!ids.length || !ids[0]) { console.log('No hay tareas listas para merge.'); break; }
      for (const id of ids) console.log(`#${id}: ${await mergeTask(ctx, id)}`);
      break;
    }
    case 'retry': {
      const t = store.get(args[0]);
      store.update(t.id, { status: 'queued', attempts: 0, error: null }, 'reencolada manualmente');
      console.log(`✔ #${t.id} reencolada${t.feedback ? ' (el Developer recibirá el último feedback)' : ''}`);
      break;
    }
    case 'cancel': {
      const t = store.get(args[0]);
      removeWorktree(repo, t.id);
      store.update(t.id, { status: 'cancelled', worktree: null, stage: null }, 'cancelada');
      console.log(`✔ #${t.id} cancelada`);
      break;
    }
    case 'stop':
      fs.writeFileSync(stopFile(repo), new Date().toISOString());
      console.log('⏸ Stop solicitado: no se lanzan agentes nuevos y los activos se pausan en su próxima etapa.');
      break;
    case 'resume':
      fs.rmSync(stopFile(repo), { force: true });
      console.log('▶ Fleet puede volver a lanzar agentes.');
      break;
    case 'report': {
      const { md, file } = writeReport(repo, store, Number(o.hours) || 24);
      console.log(md);
      console.log(`(guardado en ${file})`);
      break;
    }
    case 'audit': {
      const r = await runAudit(ctx, Number(o.days) || 7);
      console.log(r.text);
      console.log(`\n(guardado en ${r.file})`);
      break;
    }
    case 'dashboard': {
      const port = Number(o.port) || 4400;
      startDashboard({ cfg, store, isStopped: () => fs.existsSync(stopFile(repo)) }, port);
      console.log(`Tablero en http://127.0.0.1:${port}  (Ctrl+C para salir)`);
      await new Promise(() => {});
      break;
    }
    case 'config': {
      const [key, value] = args;
      if (!key) { console.log(JSON.stringify(cfg, null, 2)); break; }
      if (value === undefined) { console.log(JSON.stringify(cfg[key], null, 2)); break; }
      const raw = JSON.parse(fs.readFileSync(path.join(repo, '.fleet', 'config.json'), 'utf8'));
      let parsed = value;
      try { parsed = JSON.parse(value); } catch { /* string */ }
      raw[key] = parsed;
      saveConfig(repo, raw);
      console.log(`✔ ${key} = ${JSON.stringify(parsed)}`);
      break;
    }
    default:
      console.log(HELP);
      throw new Error(`Comando desconocido: ${cmd}`);
  }
}
