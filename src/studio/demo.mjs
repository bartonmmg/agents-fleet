import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initRepo } from '../init.mjs';
import { readRawConfig, saveConfig } from '../config.mjs';
import { Store } from '../store.mjs';
import { importTodosFile } from '../ingest.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'tienda-demo');

/** Identidad neutra para el repo demo: es un sandbox local que nunca se sube a ningún lado. */
export const DEMO_AUTHOR = { name: 'Fleet Demo', email: 'demo@fleet.local' };

function gitDemo(cwd, args) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: DEMO_AUTHOR.name, GIT_AUTHOR_EMAIL: DEMO_AUTHOR.email,
    GIT_COMMITTER_NAME: DEMO_AUTHOR.name, GIT_COMMITTER_EMAIL: DEMO_AUTHOR.email,
  };
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function freePath(target) {
  if (!fs.existsSync(target)) return target;
  for (let i = 2; ; i++) {
    const p = `${target}-${i}`;
    if (!fs.existsSync(p)) return p;
  }
}

/**
 * Crea el proyecto demo "tienda" (un carrito de compras con errores a propósito y tests),
 * lo prepara para Fleet y carga sus tareas. Devuelve la ruta del repo.
 */
export function createDemo(target) {
  const dir = freePath(path.resolve(target));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  gitDemo(dir, ['init', '-q']);
  gitDemo(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  gitDemo(dir, ['config', '--local', 'user.name', DEMO_AUTHOR.name]);
  gitDemo(dir, ['config', '--local', 'user.email', DEMO_AUTHOR.email]);
  gitDemo(dir, ['config', '--local', 'core.autocrlf', 'false']);
  gitDemo(dir, ['add', '-A']);
  gitDemo(dir, ['commit', '-q', '-m', 'Tienda demo: carrito, validación y formato']);
  initRepo(dir, { check: 'npm test', mode: 'supervised', gitAuthor: DEMO_AUTHOR });
  // Señales de ejemplo para el Product Manager: feedback de clientes y un log de errores.
  saveConfig(dir, { ...readRawConfig(dir), signals: { github: false, errorsPath: 'logs/errores.log', feedbackPath: 'feedback/' } });
  gitDemo(dir, ['add', '-A']);
  gitDemo(dir, ['commit', '-q', '-m', 'Preparar el proyecto para Fleet']);
  importTodosFile(new Store(dir), path.join(dir, 'todos.md'));
  return dir;
}
