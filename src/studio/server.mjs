import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configPath } from '../config.mjs';
import { createDemo } from './demo.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) reject(new HttpError(413, 'Pedido demasiado grande')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'JSON inválido')); } });
    req.on('error', reject);
  });
}

/** Lista subcarpetas para el explorador de carpetas de la UI. Sin ruta: unidades (Windows) o el home. */
export function listDirs(dir) {
  if (!dir) {
    if (process.platform === 'win32') {
      const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
      return { path: '', parent: null, dirs: drives.map((d) => ({ name: d, path: d, isGit: false, isFleet: false })) };
    }
    dir = os.homedir();
  }
  const abs = path.resolve(dir);
  const parentDir = path.dirname(abs);
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { throw new HttpError(400, `No se puede leer la carpeta: ${e.code || e.message}`); }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'node_modules')
    .map((e) => {
      const p = path.join(abs, e.name);
      return { name: e.name, path: p, isGit: fs.existsSync(path.join(p, '.git')), isFleet: fs.existsSync(configPath(p)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path: abs, parent: parentDir === abs ? '' : parentDir, dirs };
}

/**
 * Servidor local de Fleet Studio. Solo escucha en 127.0.0.1; las acciones (POST) exigen
 * el token de la sesión y se rechaza cualquier Host que no sea local (DNS rebinding).
 */
export function createStudioServer({ engine, fleetRoot, token = crypto.randomBytes(24).toString('hex') }) {
  const clients = new Set();
  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };
  engine.on('state', () => broadcast('state', engine.state()));
  engine.on('activity', (e) => broadcast('activity', e));
  engine.on('proposals', (r) => broadcast('proposals', r));

  const indexHtml = () => fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__FLEET_TOKEN__', token);

  const routes = [
    ['GET', /^\/api\/state$/, () => engine.state()],
    ['GET', /^\/api\/fs$/, (_m, _b, url) => listDirs(url.searchParams.get('path') || '')],
    ['POST', /^\/api\/projects\/open$/, (_m, b) => engine.open(b.path)],
    ['POST', /^\/api\/projects\/init$/, (_m, b) => engine.init(b)],
    ['POST', /^\/api\/projects\/demo$/, (_m, b) => {
      const repo = createDemo(b.path || path.join(fleetRoot, 'playground', 'tienda-demo'));
      return engine.open(repo);
    }],
    ['POST', /^\/api\/config$/, (_m, b) => { engine.updateConfig(b); return { ok: true }; }],
    ['POST', /^\/api\/run\/start$/, () => { engine.start(); return { ok: true }; }],
    ['POST', /^\/api\/run\/pause$/, () => { engine.pause(); return { ok: true }; }],
    ['POST', /^\/api\/tasks$/, (_m, b) => engine.addTask(b)],
    ['POST', /^\/api\/propose$/, (_m, b) => engine.propose(b)],
    ['POST', /^\/api\/proposals\/accept$/, (_m, b) => engine.acceptProposals(b.all ? 'all' : b.ids || [])],
    ['POST', /^\/api\/tasks\/(\d+)\/decline$/, (m, b) => engine.declineProposal(m[1], b.reason)],
    ['POST', /^\/api\/product-file$/, () => engine.createProductFile()],
    ['GET', /^\/api\/tasks\/(\d+)$/, (m) => ({ ...engine.task(m[1]), evidence: engine.evidence(m[1]) })],
    ['GET', /^\/api\/tasks\/(\d+)\/diff$/, (m) => ({ diff: engine.diff(m[1]) })],
    ['GET', /^\/api\/tasks\/(\d+)\/activity$/, (m) => engine.activity(m[1])],
    ['POST', /^\/api\/tasks\/(\d+)\/approve$/, async (m) => ({ result: await engine.approve(m[1]) })],
    ['POST', /^\/api\/tasks\/(\d+)\/request-changes$/, (m, b) => { engine.requestChanges(m[1], b.feedback); return { ok: true }; }],
    ['POST', /^\/api\/tasks\/(\d+)\/retry$/, (m) => { engine.retry(m[1]); return { ok: true }; }],
    ['POST', /^\/api\/tasks\/(\d+)\/cancel$/, (m) => { engine.cancel(m[1]); return { ok: true }; }],
    ['GET', /^\/api\/report$/, () => ({ markdown: engine.report() })],
    ['POST', /^\/api\/audit$/, async () => engine.audit()],
  ];

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) throw new HttpError(403, 'Host no permitido');
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(engine.state())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }

      const ev = url.pathname.match(/^\/api\/tasks\/(\d+)\/evidence\/([^/]+)$/);
      if (ev && req.method === 'GET') {
        const file = engine.evidencePath(ev[1], decodeURIComponent(ev[2]));
        if (!fs.existsSync(file)) throw new HttpError(404, 'No existe');
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      }

      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST' && req.headers['x-fleet-token'] !== token) throw new HttpError(403, 'Token inválido: recargá la página');
        const body = req.method === 'POST' ? await readBody(req) : {};
        for (const [method, re, handler] of routes) {
          const m = url.pathname.match(re);
          if (m && method === req.method) return send(res, 200, (await handler(m, body, url)) ?? { ok: true });
        }
        throw new HttpError(404, 'Ruta desconocida');
      }

      // Archivos estáticos de la interfaz
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, indexHtml(), TYPES['.html']);
      const file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^([/\\])+/, ''));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'No existe');
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch (err) {
      send(res, err.status || 400, { error: err.message });
    }
  });
  server.token = token;
  return server;
}
