import fs from 'node:fs';
import { PlanUsageLimit, isPause, processTask, stopFile } from './pipeline.mjs';
import { mergeTask } from './merge.mjs';
import { log, sleep } from './util.mjs';

/**
 * Elige qué tareas lanzar: prioridad (1 = alta) y antigüedad, respetando la capacidad
 * y sin poner dos agentes a la vez en la misma área (evita conflictos de merge).
 */
export function pickNext(tasks, runningIds, capacity) {
  const running = tasks.filter((t) => runningIds.has(t.id));
  const busyAreas = new Set(running.map((t) => t.area).filter(Boolean));
  const free = capacity - runningIds.size;
  const picks = [];
  const candidates = tasks
    .filter((t) => t.status === 'queued' && !runningIds.has(t.id))
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const t of candidates) {
    if (picks.length >= free) break;
    if (t.area && busyAreas.has(t.area)) continue;
    if (t.area) busyAreas.add(t.area);
    picks.push(t);
  }
  return picks;
}

/**
 * Loop principal. Por defecto vacía la cola y termina.
 *  once:  lanza solo la primera tanda.
 *  watch: sigue esperando tareas nuevas (modo nocturno).
 */
export async function runFleet(ctx, { once = false, watch = false, max } = {}) {
  const { cfg, store, repo } = ctx;
  const capacity = Number(max) || cfg.maxConcurrent;

  // Recuperación: tareas que quedaron "running" por un proceso que murió.
  for (const t of store.all().filter((x) => x.status === 'running' || x.status === 'merging')) {
    store.update(t.id, { status: t.status === 'merging' ? 'ready_to_merge' : 'queued', stage: null }, 'recuperada tras reinicio');
  }

  const active = new Map();
  let mergeChain = Promise.resolve();
  let halted = null;
  let launchedOnce = false;

  const enqueueMerge = (id) => {
    mergeChain = mergeChain.then(() => mergeTask(ctx, id)).catch((e) => log(`#${id} merge: ${e.message}`));
  };

  if (cfg.mode === 'auto') {
    for (const t of store.all().filter((x) => x.status === 'ready_to_merge')) enqueueMerge(t.id);
  }

  log(`Fleet en marcha: modo ${cfg.mode}, hasta ${capacity} agentes en paralelo, tope ${cfg.maxAgentRunsPerDay} ejecuciones/día${cfg.planOnly !== false ? ', solo plan (sin API)' : ''}`);

  let pausedUntil = 0;
  for (;;) {
    if (!halted && fs.existsSync(stopFile(repo))) halted = 'stop solicitado (fleet resume para continuar)';
    if (!halted && store.runsToday() >= cfg.maxAgentRunsPerDay) halted = `tope diario de ${cfg.maxAgentRunsPerDay} ejecuciones alcanzado`;
    const paused = Date.now() < pausedUntil;

    if (!halted && !paused && !(once && launchedOnce)) {
      const picks = pickNext(store.all(), new Set(active.keys()), capacity);
      for (const t of picks) {
        const p = processTask(ctx, t.id)
          .then((status) => { if (status === 'ready_to_merge' && cfg.mode === 'auto') enqueueMerge(t.id); })
          .catch((e) => {
            if (e instanceof PlanUsageLimit && watch) {
              pausedUntil = Date.now() + cfg.limitPauseMin * 60_000;
              log(`⏸ ${e.message}: pausa de ${cfg.limitPauseMin} min y se reintenta`);
            } else if (isPause(e)) {
              halted ||= e.message;
            } else {
              log(`#${t.id} error: ${e.message}`);
            }
          })
          .finally(() => active.delete(t.id));
        active.set(t.id, p);
      }
      if (picks.length) launchedOnce = true;
    }

    if (active.size) {
      await Promise.race(active.values());
      continue;
    }
    if (halted) { log(`Fleet detenida: ${halted}`); break; }
    if (watch && !once) {
      await sleep(cfg.pollSeconds * 1000);
      continue;
    }
    break;
  }
  await mergeChain;
  const counts = store.all().reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});
  log('Estado final:', JSON.stringify(counts), `· ${store.runsToday()} ejecuciones hoy`);
  return counts;
}
