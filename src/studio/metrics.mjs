/**
 * Métricas de la flota para la cabecera de Studio. Función pura sobre las tareas para poder testearla.
 * Los días son locales (los de la persona que mira Studio), no UTC.
 */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Sin pedidos de cambios ni reintentos, y aprobada por QA y Code Reviewer en el primer intento. */
export const firstTry = (t) => t.attempts <= 1
  && !(t.history || []).some((h) => /cambios pedidos|reintentada/.test(h.msg));

export function computeMetrics(tasks, { runsToday = 0, maxRunsPerDay = 0, now = new Date() } = {}) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ date: dayKey(d), merged: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  const week = tasks.filter((t) => t.status === 'merged' && t.mergedAt && byDay.has(dayKey(new Date(t.mergedAt))));
  for (const t of week) byDay.get(dayKey(new Date(t.mergedAt))).merged++;
  const auto = week.filter((t) => t.mergedBy === 'autopilot').length;
  const first = week.filter(firstTry).length;
  return {
    mergedToday: days.at(-1).merged,
    merged7d: week.length,
    autoMerged7d: auto,
    manualMerged7d: week.length - auto,
    firstTryRate: week.length ? Math.round((first / week.length) * 100) : null,
    runsToday,
    maxRunsPerDay,
    perDay: days,
  };
}
