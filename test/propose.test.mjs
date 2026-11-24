import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initRepo } from '../src/init.mjs';
import { loadConfig, readRawConfig, saveConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { pickNext } from '../src/scheduler.mjs';
import {
  acceptProposals, buildProposePrompt, createProductFile, declineProposal, normTitle, normalizeProposal, runProposals, taskDescription,
} from '../src/propose.mjs';
import { githubRepoOf, readSignalPath } from '../src/signals.mjs';
import { Engine } from '../src/studio/engine.mjs';

process.env.FLEET_RUNNER = 'fake';

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-propose-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@fleet.local');
  sh(dir, 'config', 'user.name', 'Fleet Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  initRepo(dir, { check: 'node -e "process.exit(0)"' });
  return dir;
}
const ctxFor = (repo) => ({ repo, cfg: loadConfig(repo), store: new Store(repo) });

test('normalizeProposal valida categoría, riesgo y criterios', () => {
  const p = normalizeProposal({ title: '  Arreglar X ', category: 'Rendimiento', risk: 'altísimo', acceptance: 'pasa', priority: 9 });
  assert.equal(p.title, 'Arreglar X');
  assert.equal(p.category, 'performance');
  assert.equal(p.risk, 'medium');
  assert.equal(p.priority, 2);
  assert.deepEqual(p.acceptance, ['pasa']);
  assert.equal(normalizeProposal({ category: 'bug' }), null);
  assert.equal(normalizeProposal({ title: 'x', category: 'inventada' }).category, 'feature');
  assert.match(taskDescription({ description: 'Hacer A', acceptance: ['B'] }), /Criterios de aceptación:\n- B/);
});

test('normTitle detecta títulos equivalentes', () => {
  assert.equal(normTitle('Agregar Tests de total()!'), normTitle('agregar tests de total'));
  assert.equal(normTitle('Validación'), normTitle('validacion'));
});

test('init crea PRODUCT.md en la raíz y no lo copia a .claude', () => {
  const repo = makeRepo();
  assert.ok(fs.existsSync(path.join(repo, 'PRODUCT.md')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude', 'PRODUCT.md')));
  assert.equal(createProductFile(repo, loadConfig(repo)).created, false);
});

test('readSignalPath lee archivos y carpetas recortando', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-signals-'));
  fs.mkdirSync(path.join(dir, 'fb'));
  fs.writeFileSync(path.join(dir, 'fb', 'a.md'), 'me gusta');
  fs.writeFileSync(path.join(dir, 'fb', 'img.png'), 'binario');
  fs.writeFileSync(path.join(dir, 'err.log'), 'x'.repeat(20000));
  assert.match(readSignalPath(dir, 'fb'), /--- a\.md\nme gusta/);
  assert.doesNotMatch(readSignalPath(dir, 'fb'), /img\.png/);
  assert.ok(readSignalPath(dir, 'err.log', 1000).length < 1100);
  assert.match(readSignalPath(dir, 'no-existe'), /no existe/);
  assert.equal(readSignalPath(dir, ''), '');
});

test('githubRepoOf reconoce remotes https y ssh', () => {
  const repo = makeRepo();
  sh(repo, 'remote', 'add', 'origin', 'https://github.com/ana/mi-app.git');
  assert.equal(githubRepoOf(repo), 'ana/mi-app');
  sh(repo, 'remote', 'set-url', 'origin', 'git@github.com:ana/otra.git');
  assert.equal(githubRepoOf(repo), 'ana/otra');
});

test('el prompt incluye brújula, descartes con motivo y señales', () => {
  const prompt = buildProposePrompt({
    cfg: { baseBranch: 'main' },
    compass: 'Prioridad: el carrito',
    tasks: [{ status: 'declined', title: 'Agregar dark mode', declineReason: 'no es prioridad' }, { status: 'queued', title: 'Arreglar total' }],
    commits: 'abc fix', audit: '', signals: { github: null, errors: 'TypeError en addItem', feedback: 'no puedo quitar productos' }, max: 3,
  });
  assert.match(prompt, /Prioridad: el carrito/);
  assert.match(prompt, /Agregar dark mode — motivo: no es prioridad/);
  assert.match(prompt, /\[queued\] Arreglar total/);
  assert.match(prompt, /TypeError en addItem/);
  assert.match(prompt, /no puedo quitar productos/);
  assert.match(prompt, /como MÁXIMO 3 tareas/);
  assert.doesNotMatch(prompt, /Issues abiertos/);
});

test('runProposals guarda propuestas, no repite y respeta el tope diario', async () => {
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  const r1 = await runProposals(ctx);
  assert.equal(r1.ok, true);
  assert.equal(r1.added.length, 2);
  const [a, b] = r1.added;
  assert.equal(a.status, 'proposed');
  assert.equal(a.category, 'test');
  assert.equal(b.risk, 'medium');
  assert.match(a.description, /Criterios de aceptación/);

  // Las propuestas no se ejecutan hasta aprobarlas
  assert.deepEqual(pickNext(ctx.store.all(), new Set(), 5), []);

  const r2 = await runProposals(ctx);
  assert.equal(r2.added.length, 0);
  assert.equal(r2.skipped, 2);

  saveConfig(repo, { ...readRawConfig(repo), product: { maxProposalsPerDay: 2 } });
  const r3 = await runProposals(ctxFor(repo));
  assert.equal(r3.ok, false);
  assert.match(r3.message, /tope de 2 propuestas/);
});

test('aprobar pasa a la cola; descartar guarda el motivo', async () => {
  const repo = makeRepo();
  const ctx = ctxFor(repo);
  const { added } = await runProposals(ctx);
  assert.equal(acceptProposals(ctx.store, [added[0].id]).length, 1);
  assert.equal(ctx.store.get(added[0].id).status, 'queued');
  assert.equal(acceptProposals(ctx.store, [added[0].id]).length, 0);
  declineProposal(ctx.store, added[1].id, 'No es prioridad');
  assert.equal(ctx.store.get(added[1].id).status, 'declined');
  assert.equal(ctx.store.get(added[1].id).declineReason, 'No es prioridad');
  assert.throws(() => declineProposal(ctx.store, added[0].id), /Solo se pueden descartar/);
});

test('Studio: proponer en segundo plano y aprobar todas', async () => {
  const repo = makeRepo();
  const engine = new Engine({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-home-')) });
  engine.open(repo);
  const done = new Promise((r) => engine.once('proposals', r));
  engine.propose();
  assert.equal(engine.state().proposing, true);
  assert.throws(() => engine.propose(), /ya está analizando/);
  const result = await done;
  assert.equal(result.ok, true);
  assert.equal(result.added.length, 2);
  await new Promise((r) => setImmediate(r));
  assert.equal(engine.state().proposing, false);
  assert.equal(engine.state().proposalsToday, 2);
  assert.equal(engine.acceptProposals('all').accepted, 2);
  assert.ok(engine.state().tasks.every((t) => t.status === 'queued'));

  engine.updateConfig({ signals: { github: true }, product: { maxProposalsPerRun: 3 } });
  const cfg = engine.state().config;
  assert.equal(cfg.signals.github, true);
  assert.equal(cfg.signals.feedbackPath, '');
  assert.equal(cfg.product.maxProposalsPerRun, 3);
  assert.equal(cfg.product.maxProposalsPerDay, 15);
});
