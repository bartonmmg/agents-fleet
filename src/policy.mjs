import { git } from './git.mjs';

/**
 * Autopilot fase 3: qué se integra solo y qué espera aprobación humana.
 *
 * Modos (cfg.mode):
 *   supervised → nada se integra solo.
 *   policy     → "por niveles": se integra solo si la categoría está en policy.autoMerge,
 *                el riesgo no es alto y no toca zonas sensibles. Las features nunca.
 *   auto       → todo lo que pase verificación y revisión se integra solo.
 */
export const CATEGORY_LABEL = {
  bug: 'Bug', test: 'Tests', refactor: 'Refactor', performance: 'Rendimiento',
  accessibility: 'Accesibilidad', feature: 'Feature', system: 'Sistema',
};

/** Categorías que nunca se integran solas en modo por niveles, aunque estén en la lista. */
const NEVER_AUTO = new Set(['feature', 'system']);

export function changedFiles(repo, base, ref) {
  return git(repo, ['diff', '--name-only', `${base}...${ref}`], { allowFail: true }).out
    .split('\n').map((f) => f.trim()).filter(Boolean);
}

const toRegex = (glob) => new RegExp(`^${glob
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '.*')}`);

/** ¿El archivo cae en alguna zona sensible? Acepta prefijos ("src/auth/") o globs ("**\/*.sql"). */
export function matchSensitive(file, patterns = []) {
  const f = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((raw) => {
    const p = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!p) return false;
    return p.includes('*') ? toRegex(p).test(f) : f.startsWith(p);
  });
}

/** Decide si una tarea lista se integra sola. Devuelve { auto, reason }. */
export function decideMerge(cfg, task, files = []) {
  const policy = cfg.policy || {};
  if (cfg.mode === 'auto') return { auto: true, reason: 'Modo automático total' };
  if (cfg.mode !== 'policy') return { auto: false, reason: 'Modo supervisado: cada integración la aprobás vos' };
  const label = CATEGORY_LABEL[task.category] || task.category;
  if (!task.category) return { auto: false, reason: 'Tarea sin categoría (cargada a mano): requiere tu aprobación' };
  if (NEVER_AUTO.has(task.category)) return { auto: false, reason: `${label}: siempre requiere tu aprobación` };
  if (!(policy.autoMerge || []).includes(task.category)) return { auto: false, reason: `${label}: no está entre las categorías que se integran solas` };
  if (task.risk === 'high') return { auto: false, reason: 'Riesgo alto: requiere tu aprobación' };
  const hits = files.filter((f) => matchSensitive(f, policy.sensitivePaths));
  if (hits.length) return { auto: false, reason: `Toca zonas sensibles: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? '…' : ''}` };
  return { auto: true, reason: `${label}, riesgo ${task.risk === 'medium' ? 'medio' : 'bajo'}, sin zonas sensibles` };
}

/** ¿Una propuesta del Product Manager puede pasar sola a la cola durante la noche? */
export function shouldAutoAccept(cfg, task) {
  const policy = cfg.policy || {};
  if (!policy.autoAcceptProposals || cfg.mode === 'supervised') return false;
  if (NEVER_AUTO.has(task.category) || task.risk === 'high') return false;
  return (policy.autoMerge || []).includes(task.category);
}

/** Recalcula y guarda la decisión de integración de una tarea lista. */
export function refreshMergeDecision(ctx, taskId) {
  const { repo, cfg, store } = ctx;
  const task = store.get(taskId);
  const files = task.branch ? changedFiles(repo, cfg.baseBranch, task.branch) : [];
  const decision = decideMerge(cfg, task, files);
  store.update(taskId, { mergeDecision: decision });
  return decision;
}
