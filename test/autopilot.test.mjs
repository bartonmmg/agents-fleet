import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initRepo } from '../src/init.mjs';
import { loadConfig, readRawConfig, saveConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { runFleet } from '../src/scheduler.mjs';
import { mergeTask } from '../src/merge.mjs';
import { decideMerge, matchSensitive, shouldAutoAccept } from '../src/policy.mjs';
import { inWindow, parseWindow, readAutopilotState } from '../src/autopilot.mjs';
import { buildReport } from '../src/report.mjs';
import { Engine } from '../src/studio/engine.mjs';

process.env.FLEET_RUNNER = 'fake';

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

function makeRepo(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ap-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@fleet.local');
  sh(dir, 'config', 'user.name', 'Fleet Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  initRepo(dir, { check: 'node -e "process.exit(0)"' });
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'fleet');
  saveConfig(dir, { ...readRawConfig(dir), mode: 'policy', ...extra });
  return dir;
}
const ctxFor = (repo) => ({ repo, cfg: loadConfig(repo), store: new Store(repo) });
const cfgPolicy = (over = {}) => ({ mode: 'policy', policy: { autoMerge: ['bug', 'test', 'refactor'], sensitivePaths: ['src/auth/', '**/*.sql'], autoAcceptProposals: true }, ...over });

test('matchSensitive: prefijos y globs', () => {
  assert.ok(matchSensitive('src/auth/login.js', ['src/auth/']));
  assert.ok(matchSensitive('db/migrations/001.sql', ['**/*.sql']));
  assert.ok(matchSensitive('src\\auth\\x.js', ['./src/auth/']));
  assert.ok(!matchSensitive('src/cart.js', ['src/auth/', '**/*.sql']));
  assert.ok(!matchSensitive('src/auth.js', ['']));
});

test('decideMerge aplica modo, categoría, riesgo y zonas sensibles', () => {
  const c = cfgPolicy();
  assert.equal(decideMerge({ ...c, mode: 'supervised' }, { category: 'bug', risk: 'low' }).auto, false);
  assert.equal(decideMerge({ ...c, mode: 'auto' }, { category: 'feature' }).auto, true);
  assert.equal(decideMerge(c, { category: 'bug', risk: 'low' }, ['src/cart.js']).auto, true);
  assert.equal(decideMerge(c, { category: 'test', risk: 'medium' }).auto, true);
  assert.match(decideMerge(c, { category: 'feature', risk: 'low' }).reason, /siempre requiere/);
  assert.match(decideMerge({ ...c, policy: { ...c.policy, autoMerge: ['bug', 'feature'] } }, { category: 'feature', risk: 'low' }).reason, /siempre requiere/);
  assert.match(decideMerge(c, { category: 'performance', risk: 'low' }).reason, /no está entre/);
  assert.match(decideMerge(c, { category: 'bug', risk: 'high' }).reason, /Riesgo alto/);
  assert.match(decideMerge(c, { category: 'bug', risk: 'low' }, ['src/auth/a.js']).reason, /zonas sensibles: src\/auth\/a\.js/);
  assert.match(decideMerge(c, { category: null }).reason, /sin categoría/);
});

test('shouldAutoAccept solo acepta propuestas de bajo riesgo permitidas', () => {
  const c = cfgPolicy();
  assert.equal(shouldAutoAccept(c, { category: 'bug', risk: 'medium' }), true);
  assert.equal(shouldAutoAccept(c, { category: 'bug', risk: 'high' }), false);
  assert.equal(shouldAutoAccept(c, { category: 'feature', risk: 'low' }), false);
  assert.equal(shouldAutoAccept({ ...c, mode: 'supervised' }, { category: 'bug', risk: 'low' }), false);
  assert.equal(shouldAutoAccept({ ...c, policy: { ...c.policy, autoAcceptProposals: false } }, { category: 'bug', risk: 'low' }), false);
});

test('parseWindow / inWindow, incluso cruzando medianoche', () => {
  const night = parseWindow('22:00-06:00');
  const at = (h, m = 0) => new Date(2026, 10, 24, h, m);
  assert.ok(inWindow(night, at(23)));
  assert.ok(inWindow(night, at(3)));
  assert.ok(!inWindow(night, at(12)));
  const early = parseWindow('01:00-07:00');
  assert.ok(inWindow(early, at(1)));
  assert.ok(!inWindow(early, at(7)));
  assert.equal(parseWindow('25:00-07:00'), null);
  assert.equal(parseWindow('nada'), null);
  assert.equal(parseWindow('03:00-03:00'), null);
});

test('modo por niveles: integra sola lo permitido y deja esperando el resto', async () => {
  const repo = makeRepo({ policy: { sensitivePaths: ['fleet-fake-3'] } });
  const ctx = ctxFor(repo);
  ctx.store.add({ title: 'bug ok', category: 'bug', risk: 'low', area: 'a' });
  ctx.store.add({ title: 'feature', category: 'feature', risk: 'low', area: 'b' });
  ctx.store.add({ title: 'bug sensible', category: 'bug', risk: 'low', area: 'c' });
  ctx.store.add({ title: 'manual sin categoría', area: 'd' });
  await runFleet(ctx, {});
  const [t1, t2, t3, t4] = ctx.store.all();
  assert.equal(t1.status, 'merged');
  assert.equal(t1.mergedBy, 'autopilot');
  assert.equal(t2.status, 'ready_to_merge');
  assert.match(t2.mergeDecision.reason, /siempre requiere/);
  assert.equal(t3.status, 'ready_to_merge');
  assert.match(t3.mergeDecision.reason, /zonas sensibles/);
  assert.equal(t4.status, 'ready_to_merge');
  // Aprobarla a mano la integra como "usuario"
  assert.equal(await mergeTask(ctx, t2.id), 'merged');
  assert.equal(ctx.store.get(t2.id).mergedBy, 'usuario');
});

test('control de salud: si falla después de integrar, revierte solo', async () => {
  const repo = makeRepo({ policy: { healthCommand: 'node -e "process.exit(1)"' } });
  const ctx = ctxFor(repo);
  const t = ctx.store.add({ title: 'rompe el build', category: 'bug', risk: 'low' });
  const before = sh(repo, 'rev-parse', 'HEAD');
  await runFleet(ctx, {});
  const task = ctx.store.get(t.id);
  assert.equal(task.status, 'needs_human');
  assert.equal(task.reverted, true);
  assert.match(task.error, /control de salud/);
  assert.ok(!fs.existsSync(path.join(repo, `fleet-fake-${t.id}.txt`)), 'el cambio tendría que estar revertido');
  assert.match(sh(repo, 'log', '-1', '--format=%s'), /^revert: tarea #1/);
  assert.notEqual(sh(repo, 'rev-parse', 'HEAD'), before);
  assert.match(buildReport(ctx.store), /Integradas/);
});

test('fin de ventana (draining): no lanza tareas nuevas', async () => {
  const repo = makeRepo();
  const ctx = { ...ctxFor(repo), draining: true };
  const t = ctx.store.add({ title: 'espera', category: 'bug', risk: 'low' });
  await runFleet(ctx, { watch: true });
  assert.equal(ctx.store.get(t.id).status, 'queued');
});

test('una noche completa: propone, aprueba por política, trabaja, integra y cierra', async () => {
  const repo = makeRepo({ schedule: { enabled: true, window: '00:00-23:59', autoPropose: true } });
  const engine = new Engine({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-home-')) });
  engine.open(repo);
  await engine.autopilotTick(new Date(2026, 10, 24, 2, 0));
  assert.equal(engine.state().autopilot.nightActive, true);
  // La flota corre en modo "watch" (no termina sola): esperar a que no quede nada pendiente
  const waitIdle = async () => {
    for (let i = 0; i < 400; i++) {
      const ts = engine.state().tasks;
      if (ts.length && ts.every((x) => !['queued', 'running', 'merging'].includes(x.status))) return ts;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timeout');
  };
  const st = engine.state();
  assert.ok(st.running, 'la flota tendría que estar en marcha');
  const tasks = await waitIdle();
  const byTitle = Object.fromEntries(tasks.map((x) => [x.title.slice(0, 20), x]));
  // El fake propone un "test" (riesgo bajo) y una "feature" (riesgo medio)
  const testTask = tasks.find((x) => x.category === 'test');
  const featTask = tasks.find((x) => x.category === 'feature');
  assert.equal(testTask.status, 'merged', JSON.stringify(byTitle));
  assert.equal(testTask.mergedBy, 'autopilot');
  assert.equal(featTask.status, 'proposed', 'las features esperan la mañana');
  const night = readAutopilotState(repo).nights.at(-1);
  assert.equal(night.proposed, 2);
  assert.equal(night.autoAccepted, 1);

  // Fin de la ventana: drena y cierra la noche
  engine.ctx.cfg.schedule.window = '03:00-04:00';
  await engine.autopilotTick(new Date(2026, 10, 24, 12, 0));
  assert.equal(engine.state().autopilot.nightActive, false);
  await engine.running;
  assert.equal(engine.state().running, false);
  assert.ok(readAutopilotState(repo).nights.at(-1).endedAt);
  assert.match(buildReport(engine.ctx.store), /🌙 Autopilot[\s\S]*Integradas solas: \*\*1\*\*/);

  // Reabrir dentro de la misma noche no vuelve a proponer
  engine.ctx.cfg.schedule.window = '00:00-23:59';
  await engine.autopilotTick(new Date(2026, 10, 24, 2, 30));
  assert.equal(readAutopilotState(repo).nights.at(-1).proposed, 0);
  engine.pause();
  await engine.running;
});
