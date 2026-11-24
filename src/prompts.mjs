import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const role = (name) => fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');

/** Roles de la flota: etapa del pipeline → nombre visible y archivo de instrucciones en prompts/. */
export const ROLES = {
  plan: { name: 'Tech Lead', file: 'tech-lead' },
  execute: { name: 'Developer', file: 'developer' },
  verify: { name: 'QA Verifier', file: 'qa-verifier' },
  review: { name: 'Code Reviewer', file: 'code-reviewer' },
  audit: { name: 'Auditor de calidad', file: 'quality-auditor' },
};

/** Enfoques del Code Reviewer. `id` sin acentos para nombres de archivo de log. */
export const REVIEW_FOCUS = [
  { id: 'correccion', name: 'CORRECCIÓN' },
  { id: 'arquitectura', name: 'ARQUITECTURA' },
  { id: 'simplicidad', name: 'SIMPLICIDAD' },
];

const taskBlock = (task) => `# Tarea #${task.id}: ${task.title}
${task.description ? `\n${task.description}\n` : ''}${task.area ? `\nÁrea: ${task.area}\n` : ''}`;

const checkBlock = (cfg) => (cfg.checkCommand
  ? `Comando de verificación del proyecto (tiene que pasar): \`${cfg.checkCommand}\``
  : 'El proyecto no definió un comando de verificación: buscá y corré los tests/lint que existan.');

export function planPrompt(cfg, task) {
  return `${role(ROLES.plan.file)}\n---\n${taskBlock(task)}\n${checkBlock(cfg)}\nRama base: ${cfg.baseBranch}\n`;
}

export function executePrompt(cfg, task, feedback) {
  return `${role(ROLES.execute.file)}\n---\n${taskBlock(task)}
## Plan del Tech Lead
${task.plan || '(sin plan: planificá brevemente antes de implementar)'}

${checkBlock(cfg)}
Rama base: ${cfg.baseBranch}. Ya estás en tu rama de trabajo; commiteá ahí.
${feedback ? `\n## ⚠ Intento anterior rechazado. Corregí esto:\n${feedback}\n` : ''}`;
}

export function verifyPrompt(cfg, task, checkOutput) {
  return `${role(ROLES.verify.file)}\n---\n${taskBlock(task)}
## Plan original
${task.plan || '(sin plan)'}

Rama base: ${cfg.baseBranch}. Revisá con \`git diff ${cfg.baseBranch}...HEAD\`.
${checkBlock(cfg)}
${checkOutput ? `\nFleet ya corrió el check determinístico y PASÓ. Últimas líneas:\n\`\`\`\n${checkOutput}\n\`\`\`\n` : ''}`;
}

export function reviewPrompt(cfg, task, focus) {
  return `${role(ROLES.review.file)}\n---\nTU ENFOQUE: **${focus.name}**\n\n${taskBlock(task)}
Rama base: ${cfg.baseBranch}. Revisá con \`git diff ${cfg.baseBranch}...HEAD\`.\n`;
}

export function auditPrompt(cfg, sinceIso, commits) {
  return `${role(ROLES.audit.file)}\n---\nRama: ${cfg.baseBranch}. Commits desde ${sinceIso}:\n${commits || '(ninguno)'}\n
Usá \`git log -p --since="${sinceIso}" ${cfg.baseBranch}\` para ver los cambios.\n`;
}

/** Cuántos enfoques de review usar según el tamaño del diff (1 a 3). */
export function pickReviewFocus(lines) {
  if (lines < 200) return REVIEW_FOCUS.slice(0, 1);
  if (lines < 800) return REVIEW_FOCUS.slice(0, 2);
  return REVIEW_FOCUS;
}
