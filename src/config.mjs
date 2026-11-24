import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './util.mjs';

export const DEFAULTS = {
  baseBranch: 'main',
  // supervised: los PRs quedan en ready_to_merge y vos mergeás con `fleet merge`.
  // auto: si pasan check + verificación + review, se mergean solos (modo nocturno).
  mode: 'supervised',
  maxConcurrent: 3,
  maxAttempts: 2,
  // Comando determinístico que tiene que pasar SIEMPRE (lint + typecheck + tests + build).
  checkCommand: '',
  checkTimeoutMin: 20,
  stageTimeoutMin: 40,
  // Solo plan: los agentes usan la sesión de Claude Code (tu suscripción). Fleet quita
  // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN del entorno de cada agente para que nunca se facture por API.
  planOnly: true,
  // Tope de ejecuciones de agentes por día, para no agotar la cuota del plan en una sola noche.
  maxAgentRunsPerDay: 150,
  // Si el plan llega a su límite de uso: en --watch se espera y se reintenta; si no, la flota se detiene.
  limitPauseMin: 30,
  pollSeconds: 60,
  claudeCommand: 'claude',
  permissionMode: 'acceptEdits',
  models: {
    plan: 'opus',
    execute: 'opus',
    verify: 'sonnet',
    review: 'sonnet',
    audit: 'sonnet',
  },
  maxTurns: {
    plan: 25,
    execute: 100,
    verify: 50,
    review: 30,
    audit: 50,
  },
  allowedTools: [
    'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
    'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
    'Bash(git add:*)', 'Bash(git commit:*)',
    'Bash(npm run:*)', 'Bash(npm test:*)', 'Bash(npx:*)', 'Bash(node:*)',
    'Bash(pnpm:*)', 'Bash(yarn:*)',
  ],
};

export const fleetDir = (repo) => path.join(repo, '.fleet');
export const configPath = (repo) => path.join(fleetDir(repo), 'config.json');

export function loadConfig(repo) {
  const file = configPath(repo);
  if (!fs.existsSync(file)) {
    throw new Error(`No hay configuración de Fleet en ${repo}. Corré primero: fleet init --repo "${repo}"`);
  }
  const user = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    ...DEFAULTS,
    ...user,
    models: { ...DEFAULTS.models, ...(user.models || {}) },
    maxTurns: { ...DEFAULTS.maxTurns, ...(user.maxTurns || {}) },
    allowedTools: user.allowedTools || DEFAULTS.allowedTools,
  };
}

export function saveConfig(repo, cfg) {
  writeAtomic(configPath(repo), `${JSON.stringify(cfg, null, 2)}\n`);
}
