import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetDir } from './config.mjs';
import { git } from './git.mjs';
import { runAgent } from './runner.mjs';
import { ROLES } from './prompts.mjs';
import { collectSignals } from './signals.mjs';
import { extractJson, log, now, tail, today } from './util.mjs';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export const CATEGORIES = ['bug', 'test', 'refactor', 'performance', 'accessibility', 'feature', 'system'];
const CATEGORY_ALIASES = {
  error: 'bug', fix: 'bug', tests: 'test', testing: 'test', perf: 'performance', rendimiento: 'performance',
  a11y: 'accessibility', accesibilidad: 'accessibility', limpieza: 'refactor', cleanup: 'refactor',
  sistema: 'system', tooling: 'system', funcionalidad: 'feature',
};
const RISKS = ['low', 'medium', 'high'];

export const productFilePath = (repo, cfg) => path.resolve(repo, cfg.product?.file || 'PRODUCT.md');

/** Normaliza un título para detectar duplicados ("Agregar tests!" ≈ "agregar tests"). */
export const normTitle = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function normalizeProposal(p) {
  if (!p || typeof p !== 'object' || !String(p.title || '').trim()) return null;
  let category = String(p.category || '').toLowerCase().trim();
  category = CATEGORY_ALIASES[category] || category;
  if (!CATEGORIES.includes(category)) category = 'feature';
  let risk = String(p.risk || '').toLowerCase().trim();
  if (!RISKS.includes(risk)) risk = 'medium';
  const acceptance = (Array.isArray(p.acceptance) ? p.acceptance : [p.acceptance]).map((a) => String(a || '').trim()).filter(Boolean).slice(0, 8);
  return {
    title: String(p.title).trim().slice(0, 160),
    category,
    risk,
    priority: [1, 2, 3].includes(Number(p.priority)) ? Number(p.priority) : 2,
    area: p.area ? String(p.area).trim().slice(0, 60) : null,
    rationale: String(p.rationale || '').trim().slice(0, 1500),
    description: String(p.description || '').trim().slice(0, 4000),
    acceptance,
    source: String(p.source || '').trim().slice(0, 80),
  };
}

/** Texto que recibe el Developer: descripción + criterios de aceptación. */
export function taskDescription(p) {
  const parts = [p.description];
  if (p.acceptance?.length) parts.push(`Criterios de aceptación:\n${p.acceptance.map((a) => `- ${a}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}

function latestAudit(repo) {
  const dir = path.join(fleetDir(repo), 'audits');
  if (!fs.existsSync(dir)) return '';
  const last = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().pop();
  return last ? tail(fs.readFileSync(path.join(dir, last), 'utf8'), 3000) : '';
}

export function proposalsToday(store) {
  const d = today();
  return store.all().filter((t) => t.source === 'product' && String(t.createdAt).startsWith(d)).length;
}

/** Arma el pedido para el Product Manager con la brújula, el contexto y las señales. */
export function buildProposePrompt({ cfg, compass, tasks, commits, audit, signals, max }) {
  const role = fs.readFileSync(path.join(PROMPTS_DIR, 'product-manager.md'), 'utf8');
  const existing = tasks.filter((t) => t.status !== 'declined').slice(-80)
    .map((t) => `- [${t.status}] ${t.title}`).join('\n');
  const declined = tasks.filter((t) => t.status === 'declined').slice(-40)
    .map((t) => `- ${t.title}${t.declineReason ? ` — motivo: ${t.declineReason}` : ''}`).join('\n');
  const failures = tasks.filter((t) => t.status === 'needs_human').slice(-10)
    .map((t) => `- ${t.title}: ${String(t.error || '').split('\n')[0].slice(0, 200)}`).join('\n');
  const section = (title, body) => (body ? `\n## ${title}\n${body}\n` : '');
  return `${role}
---
# BRÚJULA (PRODUCT.md)
${compass || '(No hay PRODUCT.md: proponé solo bugs evidentes, tests faltantes y mejoras de bajo riesgo; nada de features.)'}
${section('Tareas que ya existen (no las repitas)', existing)}${section('Propuestas DESCARTADAS por el humano (no las repitas; respetá el motivo)', declined)}${section('Tareas que fallaron recientemente', failures)}${section(`Commits recientes en ${cfg.baseBranch}`, commits)}${section('Última auditoría de calidad', audit)}${section('Issues abiertos de GitHub', signals.github)}${section('Errores de la app (más recientes)', signals.errors)}${section('Feedback de usuarios', signals.feedback)}
Proponé como MÁXIMO ${max} tareas. Rama base: ${cfg.baseBranch}.
`;
}

/**
 * Corre el Product Manager: lee brújula + señales, propone tareas y las guarda con estado
 * "proposed" (no se ejecutan hasta que un humano las aprueba). Devuelve { added, skipped, ok, message }.
 */
export async function runProposals(ctx, { max } = {}) {
  const { repo, cfg, store } = ctx;
  const remaining = cfg.product.maxProposalsPerDay - proposalsToday(store);
  if (remaining <= 0) return { ok: false, added: [], skipped: 0, message: `Ya se alcanzó el tope de ${cfg.product.maxProposalsPerDay} propuestas por día.` };
  if (store.runsToday() >= cfg.maxAgentRunsPerDay) return { ok: false, added: [], skipped: 0, message: 'Se alcanzó el tope diario de ejecuciones de agentes.' };
  const limit = Math.max(1, Math.min(Number(max) || cfg.product.maxProposalsPerRun, remaining));

  const compassFile = productFilePath(repo, cfg);
  const compass = fs.existsSync(compassFile) ? tail(fs.readFileSync(compassFile, 'utf8'), 12000) : '';
  const commits = git(repo, ['log', '--oneline', '-20', cfg.baseBranch], { allowFail: true }).out;
  const signals = await collectSignals(repo, cfg);
  const prompt = buildProposePrompt({ cfg, compass, tasks: store.all(), commits, audit: latestAudit(repo), signals, max: limit });

  const role = ROLES.propose.name;
  const emit = (ev) => { try { ctx.onActivity?.({ taskId: 0, stage: 'propose', role, at: now(), ...ev }); } catch { /* no crítico */ } };
  emit({ kind: 'info', text: `${role} analizando el proyecto` });
  log(`▶ ${role}: buscando mejoras (máx. ${limit})`);
  const res = await runAgent({
    cfg, cwd: repo, prompt, model: cfg.models.propose, readOnly: true, stage: 'propose', taskId: 0,
    maxTurns: cfg.maxTurns.propose,
    logFile: path.join(fleetDir(repo), 'runs', 'propose', `${Date.now()}.log`),
    onEvent: emit,
  });
  store.addRun(0, 'propose', res.costUsd);
  if (!res.ok) return { ok: false, added: [], skipped: 0, message: res.limited ? 'El plan de Claude alcanzó su límite de uso.' : `El Product Manager falló: ${tail(res.text, 400)}` };

  let raw = extractJson(res.text);
  if (raw && !Array.isArray(raw)) raw = raw.proposals || raw.tasks || [];
  if (!Array.isArray(raw)) return { ok: false, added: [], skipped: 0, message: 'El Product Manager no devolvió una lista de propuestas válida.' };

  const seen = new Set(store.all().map((t) => normTitle(t.title)));
  const added = [];
  let skipped = 0;
  for (const p of raw.map(normalizeProposal).filter(Boolean)) {
    if (added.length >= limit || seen.has(normTitle(p.title))) { skipped++; continue; }
    seen.add(normTitle(p.title));
    added.push(store.add({
      title: p.title, description: taskDescription(p), area: p.area, priority: p.priority,
      status: 'proposed', source: 'product', category: p.category, risk: p.risk,
      rationale: p.source ? `${p.rationale}\n\nFuente: ${p.source}` : p.rationale, acceptance: p.acceptance,
    }));
  }
  const message = added.length ? `${added.length} propuestas nuevas` : 'El Product Manager no encontró nada valioso para proponer ahora.';
  log(`✔ ${role}: ${message}${skipped ? ` (${skipped} repetidas descartadas)` : ''}`);
  emit({ kind: 'info', text: message });
  return { ok: true, added, skipped, message };
}

/** Aprueba propuestas: pasan a la cola de trabajo. */
export function acceptProposals(store, ids) {
  const accepted = [];
  for (const id of ids) {
    const t = store.get(id);
    if (t.status !== 'proposed') continue;
    accepted.push(store.update(t.id, { status: 'queued' }, 'propuesta aprobada'));
  }
  return accepted;
}

/** Descarta una propuesta; el motivo se le muestra al Product Manager en las próximas corridas. */
export function declineProposal(store, id, reason = '') {
  const t = store.get(id);
  if (t.status !== 'proposed') throw new Error('Solo se pueden descartar propuestas.');
  return store.update(t.id, { status: 'declined', declineReason: String(reason || '').trim().slice(0, 500) || null }, `propuesta descartada${reason ? `: ${reason}` : ''}`);
}

/** Crea PRODUCT.md desde la plantilla, si no existe. */
export function createProductFile(repo, cfg) {
  const file = productFilePath(repo, cfg);
  if (fs.existsSync(file)) return { created: false, file };
  fs.copyFileSync(path.join(TEMPLATES, 'PRODUCT.md'), file);
  return { created: true, file };
}
