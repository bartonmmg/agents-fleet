import fs from 'node:fs';
import path from 'node:path';
import { fleetDir } from './config.mjs';
import { runProposals } from './propose.mjs';
import { shouldAutoAccept } from './policy.mjs';
import { log, now, writeAtomic } from './util.mjs';

/** "01:00-07:00" → { start: 60, end: 420 } en minutos. Soporta cruzar medianoche ("22:00-06:00"). */
export function parseWindow(str) {
  const m = String(str || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const start = h1 * 60 + m1;
  const end = h2 * 60 + m2;
  return start === end ? null : { start, end };
}

export function inWindow(win, date = new Date()) {
  if (!win) return false;
  const t = date.getHours() * 60 + date.getMinutes();
  return win.start < win.end ? t >= win.start && t < win.end : t >= win.start || t < win.end;
}

const stateFile = (repo) => path.join(fleetDir(repo), 'autopilot.json');

export function readAutopilotState(repo) {
  try { return JSON.parse(fs.readFileSync(stateFile(repo), 'utf8')); } catch { return { nights: [] }; }
}

function saveAutopilotState(repo, st) {
  st.nights = (st.nights || []).slice(-30);
  writeAtomic(stateFile(repo), JSON.stringify(st, null, 2));
}

/**
 * Inicio de la noche: el Product Manager propone (una vez por noche) y las propuestas que la
 * política permite pasan solas a la cola. Las features y lo de riesgo alto quedan para la mañana.
 */
export async function startNight(ctx, { propose = true } = {}) {
  const { repo, cfg, store } = ctx;
  const st = readAutopilotState(repo);
  const night = { startedAt: now(), endedAt: null, proposed: 0, autoAccepted: 0, notes: [] };
  const last = st.nights?.at(-1);
  const recentlyProposed = last && Date.now() - new Date(last.startedAt).getTime() < 12 * 3600_000 && last.proposed >= 0 && last.proposeDone;

  if (propose && cfg.schedule?.autoPropose && !recentlyProposed) {
    const r = await runProposals(ctx);
    night.proposed = r.added.length;
    night.proposeDone = true;
    night.notes.push(`Product Manager: ${r.message}`);
  }
  for (const t of store.all().filter((x) => x.status === 'proposed')) {
    if (!shouldAutoAccept(cfg, t)) continue;
    store.update(t.id, { status: 'queued' }, 'aprobada automáticamente por Autopilot (política nocturna)');
    night.autoAccepted++;
  }
  log(`🌙 Autopilot: noche iniciada (${night.proposed} propuestas, ${night.autoAccepted} aprobadas por política)`);
  st.nights = [...(st.nights || []), night];
  saveAutopilotState(repo, st);
  return night;
}

export function endNight(repo) {
  const st = readAutopilotState(repo);
  const night = st.nights?.at(-1);
  if (night && !night.endedAt) {
    night.endedAt = now();
    saveAutopilotState(repo, st);
    log('☀ Autopilot: fin de la ventana nocturna (los agentes en curso terminan su tarea)');
  }
  return night;
}
