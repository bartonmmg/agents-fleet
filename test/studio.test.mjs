import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Engine } from '../src/studio/engine.mjs';
import { createStudioServer, listDirs, reportHours } from '../src/studio/server.mjs';
import { FLEET_ROOT } from '../src/studio/index.mjs';
import { DEMO_AUTHOR } from '../src/studio/demo.mjs';
import { applyGitIdentity } from '../src/config.mjs';
import { streamLineToEvents } from '../src/runner.mjs';

process.env.FLEET_RUNNER = 'fake';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-studio-'));
const engine = new Engine({ home: path.join(tmp, 'home') });
const server = createStudioServer({ engine, fleetRoot: FLEET_ROOT });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

after(() => {
  engine.ctx && fs.writeFileSync(path.join(engine.ctx.repo, '.fleet', 'STOP'), 'fin');
  engine.wakeup.notify();
  server.close();
  server.closeAllConnections?.();
});

const call = async (method, url, body, { token = server.token } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-fleet-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const waitFor = async (fn, ms = 60_000) => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 150));
  }
};

test('la página se sirve con el token y sin proyecto abierto', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Fleet Studio/);
  assert.ok(html.includes(server.token));
  const { data } = await call('GET', '/api/state');
  assert.equal(data.project, null);
});

test('las acciones exigen token', async () => {
  const { status, data } = await call('POST', '/api/run/start', {}, { token: '' });
  assert.equal(status, 403);
  assert.match(data.error, /Token/);
});

test('rechaza un Host que no sea local (DNS rebinding)', async () => {
  const http = await import('node:http');
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/state', headers: { host: 'evil.example.com' } }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(status, 403);
});

test('reportHours acota el período del informe', () => {
  assert.equal(reportHours(null), 24);
  assert.equal(reportHours('abc'), 24);
  assert.equal(reportHours('168'), 168);
  assert.equal(reportHours('0'), 24);
  assert.equal(reportHours('99999'), 720);
});

test('listDirs lista subcarpetas y marca repos', () => {
  const r = listDirs(FLEET_ROOT);
  assert.ok(r.dirs.some((d) => d.name === 'src'));
  assert.ok(!r.dirs.some((d) => d.name.startsWith('.')));
});

test('streamLineToEvents resume herramientas y texto', () => {
  const evs = streamLineToEvents({ type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.js' } },
    { type: 'text', text: 'Listo' },
  ] } });
  assert.deepEqual(evs, [{ kind: 'tool', text: 'Read: src/a.js' }, { kind: 'text', text: 'Listo' }]);
});

test('applyGitIdentity fija y limpia la identidad', () => {
  const env = { GIT_AUTHOR_NAME: 'viejo' };
  assert.equal(applyGitIdentity({ gitAuthor: { name: 'Ana', email: 'ana@x.dev' } }, env), true);
  assert.equal(env.GIT_COMMITTER_EMAIL, 'ana@x.dev');
  assert.equal(applyGitIdentity({ gitAuthor: { name: '', email: '' } }, env), false);
  assert.equal(env.GIT_AUTHOR_NAME, undefined);
});

test('flujo completo: demo → iniciar → aprobar desde la API', async () => {
  const demoPath = path.join(tmp, 'tienda');
  // La demo se crea vía API en la ruta pedida
  const created = await call('POST', '/api/projects/demo', { path: demoPath });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  let { data: st } = await call('GET', '/api/state');
  assert.equal(st.project.name, 'tienda');
  assert.equal(st.tasks.length, 4);
  assert.deepEqual(st.config.gitAuthor, DEMO_AUTHOR);

  // Tarea manual con validación
  assert.equal((await call('POST', '/api/tasks', { title: '  ' })).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: 'Extra', area: 'otra' })).status, 200);

  await call('POST', '/api/run/start');
  st = await waitFor(async () => {
    const s = (await call('GET', '/api/state')).data;
    return s.tasks.every((t) => t.status === 'ready_to_merge') ? s : null;
  });

  const t1 = st.tasks.find((t) => t.id === 1);
  assert.deepEqual(t1.steps.map((s) => s.stage), ['plan', 'execute', 'check', 'verify', 'review']);
  assert.ok(t1.steps.every((s) => s.status === 'ok'));

  const act = (await call('GET', '/api/tasks/1/activity')).data;
  assert.ok(act.some((a) => a.kind === 'tool' && a.role === 'Developer'));
  const diff = (await call('GET', '/api/tasks/1/diff')).data.diff;
  assert.match(diff, /fleet-fake-1\.txt/);

  // Pedir cambios devuelve la tarea a la cola con el feedback del usuario
  assert.equal((await call('POST', '/api/tasks/2/request-changes', { feedback: '' })).status, 400);
  assert.equal((await call('POST', '/api/tasks/2/request-changes', { feedback: 'Agregá un test más' })).status, 200);

  const approved = await call('POST', '/api/tasks/1/approve');
  assert.equal(approved.data.result, 'merged');
  const author = spawnSync('git', ['log', '-1', '--format=%an <%ae>|%cn <%ce>'], { cwd: engine.ctx.repo, encoding: 'utf8' }).stdout.trim();
  assert.equal(author, `${DEMO_AUTHOR.name} <${DEMO_AUTHOR.email}>|${DEMO_AUTHOR.name} <${DEMO_AUTHOR.email}>`);

  // Métricas: la integración recién aprobada cuenta para hoy
  const metrics = (await call('GET', '/api/metrics')).data;
  assert.equal(metrics.mergedToday, 1);
  assert.equal(metrics.manualMerged7d, 1);
  assert.equal(metrics.perDay.length, 7);
  assert.ok(metrics.runsToday > 0);
  assert.deepEqual((await call('GET', '/api/state')).data.metrics, metrics);
  assert.match((await call('GET', '/api/report')).data.markdown, /últimas 24 h/);
  assert.match((await call('GET', '/api/report?hours=168')).data.markdown, /últimas 168 h/);

  // El diff sigue disponible después de integrar (la rama ya no existe)
  assert.match((await call('GET', '/api/tasks/1/diff')).data.diff, /fleet-fake-1\.txt/);

  // Configuración
  assert.equal((await call('POST', '/api/config', { maxConcurrent: 5, mode: 'auto' })).status, 200);
  st = (await call('GET', '/api/state')).data;
  assert.equal(st.config.maxConcurrent, 5);
  assert.equal(st.config.mode, 'auto');

  await call('POST', '/api/run/pause');
  await waitFor(async () => !(await call('GET', '/api/state')).data.running, 30_000);
});
