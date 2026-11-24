#!/usr/bin/env node
/**
 * Capturas de Fleet Studio para verificar cambios visuales (sin dependencias: usa Edge/Chrome instalado).
 *
 *   node scripts/capture.mjs [--out .fleet-evidence] [--name prefijo] [--paths /,/otra]
 *
 * Levanta Studio con agentes simulados sobre una tienda demo con tareas en todos los estados
 * (propuestas, en cola, listas, que necesitan ayuda, integradas) y saca capturas en
 * escritorio y celular, modo claro y oscuro. Imprime las rutas de las imágenes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Asíncrono a propósito: el servidor de Studio corre en este mismo proceso y tiene que poder responderle al navegador.
const run = (cmd, argv, timeoutMs) => new Promise((resolve) => {
  const child = spawn(cmd, argv, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.on('close', () => { clearTimeout(timer); resolve({ stderr }); });
  child.on('error', (e) => { clearTimeout(timer); resolve({ stderr: e.message }); });
});
import { fileURLToPath } from 'node:url';

process.env.FLEET_RUNNER = 'fake';
process.env.FLEET_FAKE_DELAY_MS = '0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(new URL(`file:///${path.join(ROOT, p).replace(/\\/g, '/')}`).href);
const { Engine } = await imp('src/studio/engine.mjs');
const { createStudioServer } = await imp('src/studio/server.mjs');
const { createDemo } = await imp('src/studio/demo.mjs');
const { runFleet } = await imp('src/scheduler.mjs');
const { mergeTask } = await imp('src/merge.mjs');
const { runProposals } = await imp('src/propose.mjs');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(arg('out', '.fleet-evidence'));
const prefix = arg('name', 'studio');
const paths = arg('paths', '/').split(',').map((p) => p.trim()).filter(Boolean);

const BROWSERS = [
  process.env.FLEET_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) { console.error('No encontré Edge ni Chrome. Definí FLEET_BROWSER con la ruta del navegador.'); process.exit(1); }

// 1. Datos de ejemplo en una carpeta temporal
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-capture-'));
const repo = createDemo(path.join(tmp, 'tienda-demo'));
const engine = new Engine({ home: path.join(tmp, 'home') });
engine.open(repo);
const ctx = engine.ctx;
await runFleet(ctx, {});
const ready = ctx.store.all().filter((t) => t.status === 'ready_to_merge');
for (const t of ready.slice(0, 2)) await mergeTask(ctx, t.id);
await runProposals(ctx);
const help = ctx.store.all().find((t) => t.status === 'ready_to_merge');
if (help) ctx.store.update(help.id, { status: 'needs_human', error: 'El QA Verifier RECHAZÓ el trabajo: el total con descuento sigue dando 81 (simulado).' }, 'necesita revisión humana');
ctx.store.add({ title: 'Agregar envío gratis desde $50.000', area: 'carrito', category: 'feature', risk: 'medium' });
// Una noche de Autopilot reciente: una de las integradas entró sola por la política.
const merged = ctx.store.all().filter((t) => t.status === 'merged');
if (merged[0]) ctx.store.update(merged[0].id, { mergedBy: 'autopilot', mergeDecision: { auto: true, reason: 'Bug de riesgo medio: la política permite integrarlo solo.' } });
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
fs.writeFileSync(path.join(repo, '.fleet', 'autopilot.json'), JSON.stringify({ nights: [{ startedAt: hoursAgo(7), endedAt: hoursAgo(1), proposed: 2, autoAccepted: 1, notes: [] }] }));

// 2. Servidor
const server = createStudioServer({ engine, fleetRoot: tmp });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 3. Capturas
fs.mkdirSync(outDir, { recursive: true });
const VIEWS = [
  { name: 'desktop', size: '1366,900' },
  { name: 'mobile', size: '390,844' },
];
const SCHEMES = [{ name: 'claro', flag: 'preferredColorScheme=1' }, { name: 'oscuro', flag: 'preferredColorScheme=0' }];
const shots = [];
for (const p of paths) {
  const slug = p === '/' ? 'inicio' : p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  for (const v of VIEWS) {
    for (const s of SCHEMES) {
      const file = path.join(outDir, `${prefix}-${slug}-${v.name}-${s.name}.png`);
      const r = await run(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${path.join(tmp, `profile-${v.name}-${s.name}`)}`,
        `--window-size=${v.size}`, `--blink-settings=${s.flag}`, '--virtual-time-budget=6000',
        `--screenshot=${file}`, `${base}${p}${p.includes("?") ? "&" : "?"}snapshot=1`,
      ], 30_000);
      if (fs.existsSync(file)) shots.push(file);
      else console.error(`No se pudo capturar ${file}: ${r.stderr}`.slice(0, 300));
    }
  }
}
server.close();
server.closeAllConnections?.();
engine.pause();
console.log(`Capturas (${shots.length}):`);
shots.forEach((f) => console.log(`  ${path.relative(process.cwd(), f)}`));
process.exit(shots.length ? 0 : 1);
