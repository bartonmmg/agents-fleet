import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.mjs';
import { createStudioServer } from './server.mjs';

export const FLEET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* el usuario puede abrirlo a mano */ }
}

/** Levanta Fleet Studio: abre el último proyecto usado (o `project`) y sirve la interfaz en 127.0.0.1. */
export async function startStudio({ port = 4400, open = true, project, home = path.join(FLEET_ROOT, '.studio') } = {}) {
  const engine = new Engine({ home });
  const target = project || engine.recentProjects()[0]?.path;
  if (target) {
    try {
      const r = engine.open(target);
      if (r.needsInit && project) console.log(`ℹ ${target} todavía no está preparado: abrilo desde Studio para configurarlo.`);
    } catch (e) {
      console.log(`ℹ No se pudo abrir ${target}: ${e.message}`);
    }
  }
  const server = createStudioServer({ engine, fleetRoot: FLEET_ROOT });
  engine.startAutopilotTimer().catch((e) => console.log(`Autopilot: ${e.message}`));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Fleet Studio en ${url}  (dejá esta ventana abierta; Ctrl+C para cerrar)`);
  if (open) openBrowser(url);
  return { server, engine, url };
}
