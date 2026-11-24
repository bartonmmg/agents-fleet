import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTodos } from '../src/ingest.mjs';
import { pickNext } from '../src/scheduler.mjs';
import { extractJson } from '../src/util.mjs';
import { pickReviewFocus } from '../src/prompts.mjs';
import { agentEnv, isUsageLimit } from '../src/runner.mjs';
import { initRepo } from '../src/init.mjs';
import { loadConfig, saveConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { runFleet } from '../src/scheduler.mjs';
import { mergeTask } from '../src/merge.mjs';
import { buildReport } from '../src/report.mjs';

process.env.FLEET_RUNNER = 'fake';

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

function makeRepo({ check = 'node -e "process.exit(0)"', mode = 'auto' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'fleet@test.local');
  sh(dir, 'config', 'user.name', 'Fleet Test');
  sh(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  const { repo } = initRepo(dir, { check, mode });
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'fleet init');
  return repo;
}

const ctxFor = (repo) => ({ repo, cfg: loadConfig(repo), store: new Store(repo) });

beforeEach(() => { delete process.env.FLEET_FAKE_FAIL; });

test('parseTodos lee título, área, prioridad y descripción', () => {
  const tasks = parseTodos(`# Backlog
- [ ] Agregar login #auth !1
  usar el proveedor existente
- [x] Hecha
- [ ] Mejorar tabla #ui
`);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], { title: 'Agregar login', area: 'auth', priority: 1, description: 'usar el proveedor existente' });
  assert.equal(tasks[1].area, 'ui');
  assert.equal(tasks[1].priority, 2);
});

test('pickNext respeta capacidad, prioridad y no repite área', () => {
  const tasks = [
    { id: 1, status: 'queued', priority: 2, area: 'ui' },
    { id: 2, status: 'queued', priority: 1, area: 'ui' },
    { id: 3, status: 'queued', priority: 2, area: 'api' },
    { id: 4, status: 'queued', priority: 3, area: null },
    { id: 5, status: 'merged', priority: 1, area: null },
  ];
  assert.deepEqual(pickNext(tasks, new Set(), 3).map((t) => t.id), [2, 3, 4]);
  assert.deepEqual(pickNext(tasks, new Set([3]), 2).map((t) => t.id), [2]);
});

test('extractJson toma el último bloque JSON', () => {
  assert.deepEqual(extractJson('bla\n```json\n{"verdict":"fail"}\n```\nmás\n```json\n{"verdict":"pass"}\n```'), { verdict: 'pass' });
  assert.deepEqual(extractJson('resultado: {"verdict": "pass", "x": {"y": 1}} fin'), { verdict: 'pass', x: { y: 1 } });
  assert.equal(extractJson('sin json'), null);
});

test('pickReviewFocus escala con el tamaño del diff', () => {
  assert.equal(pickReviewFocus(50).length, 1);
  assert.equal(pickReviewFocus(500).length, 2);
  assert.equal(pickReviewFocus(5000).length, 3);
});

test('init crea config, .gitignore y plantillas sin pisar', () => {
  const repo = makeRepo();
  const cfg = loadConfig(repo);
  assert.equal(cfg.baseBranch, 'main');
  assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /\.fleet\//);
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'skills', 'fleet-verify', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'agents', 'fleet-qa-verifier.md')));
});

test('modo auto: tareas en paralelo se verifican y se mergean en main', async () => {
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  ctx.store.add({ title: 'A', area: 'ui' });
  ctx.store.add({ title: 'B', area: 'api' });
  ctx.store.add({ title: 'C', area: 'ui' });
  await runFleet(ctx, {});
  const tasks = ctx.store.all();
  assert.deepEqual(tasks.map((t) => t.status), ['merged', 'merged', 'merged']);
  for (const t of tasks) assert.ok(fs.existsSync(path.join(repo, `fleet-fake-${t.id}.txt`)), `falta el archivo de #${t.id}`);
  assert.equal(sh(repo, 'branch', '--list', 'fleet/*'), '');
  assert.match(buildReport(ctx.store), /Mergeadas/);
});

test('modo supervisado: queda lista y se mergea con mergeTask', async () => {
  const repo = makeRepo({ mode: 'supervised' });
  const ctx = ctxFor(repo);
  const t = ctx.store.add({ title: 'Supervisada' });
  await runFleet(ctx, {});
  assert.equal(ctx.store.get(t.id).status, 'ready_to_merge');
  assert.equal(await mergeTask(ctx, t.id), 'merged');
  assert.ok(fs.existsSync(path.join(repo, `fleet-fake-${t.id}.txt`)));
});

test('si el QA Verifier rechaza, reintenta y termina en needs_human', async () => {
  process.env.FLEET_FAKE_FAIL = 'verify';
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  const t = ctx.store.add({ title: 'Mala' });
  await runFleet(ctx, {});
  const task = ctx.store.get(t.id);
  assert.equal(task.status, 'needs_human');
  assert.equal(task.attempts, 2);
  assert.match(task.error, /QA Verifier RECHAZÓ/);
});

test('si el check determinístico falla, no llega al verificador', async () => {
  const repo = makeRepo({ check: 'node -e "process.exit(3)"' });
  const ctx = ctxFor(repo);
  const t = ctx.store.add({ title: 'Rompe tests' });
  await runFleet(ctx, {});
  const task = ctx.store.get(t.id);
  assert.equal(task.status, 'needs_human');
  assert.match(task.error, /FALLÓ/);
  assert.equal(task.verdicts.verify, undefined);
});

test('tope diario de ejecuciones: no lanza agentes', async () => {
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  const raw = JSON.parse(fs.readFileSync(path.join(repo, '.fleet', 'config.json'), 'utf8'));
  saveConfig(repo, { ...raw, maxAgentRunsPerDay: 0 });
  const t = ctx.store.add({ title: 'Cara' });
  await runFleet({ ...ctx, cfg: loadConfig(repo) }, {});
  assert.equal(ctx.store.get(t.id).status, 'queued');
});

test('planOnly quita las credenciales de API del entorno de los agentes', () => {
  const base = { ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', PATH: 'p' };
  const env = agentEnv({ planOnly: true }, base);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.PATH, 'p');
  assert.equal(agentEnv({ planOnly: false }, base).ANTHROPIC_API_KEY, 'sk-x');
});

test('isUsageLimit reconoce el límite del plan', () => {
  assert.ok(isUsageLimit('Claude AI usage limit reached|1764000000'));
  assert.ok(isUsageLimit('Error: 429 rate_limit_error'));
  assert.ok(!isUsageLimit('Tests fallaron en auth.test.ts'));
});

test('límite del plan: la tarea vuelve a la cola, no se marca como fallida', async () => {
  process.env.FLEET_FAKE_FAIL = 'limit';
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  const t = ctx.store.add({ title: 'Sin cuota' });
  await runFleet(ctx, {});
  const task = ctx.store.get(t.id);
  assert.equal(task.status, 'queued');
  assert.match(task.history.at(-1).msg, /límite de uso/);
});
