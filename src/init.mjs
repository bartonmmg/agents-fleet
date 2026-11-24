import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, configPath, fleetDir, saveConfig } from './config.mjs';
import { currentBranch, hasCommits, isGitRepo, repoRoot } from './git.mjs';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

function detectCheckCommand(repo) {
  const pkgFile = path.join(repo, 'package.json');
  if (!fs.existsSync(pkgFile)) return '';
  const scripts = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts || {};
  const pm = fs.existsSync(path.join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(repo, 'yarn.lock')) ? 'yarn' : 'npm';
  const run = (s) => (pm === 'npm' ? `npm run ${s}` : `${pm} ${s}`);
  if (scripts.check) return run('check');
  return ['lint', 'typecheck', 'test', 'build'].filter((s) => scripts[s]).map(run).join(' && ');
}

/** Copia sin pisar: si el archivo ya existe en el proyecto, se respeta. */
function copyMissing(src, dest, created) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyMissing(s, d, created); }
    else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); created.push(d); }
  }
}

function ensureGitignore(repo, lines) {
  const file = path.join(repo, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const missing = lines.filter((l) => !current.split(/\r?\n/).includes(l));
  if (missing.length) fs.writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  return missing;
}

export function initRepo(dir, { check, mode, skills = true } = {}) {
  if (!isGitRepo(dir)) throw new Error(`${dir} no es un repositorio git`);
  const repo = repoRoot(dir);
  if (!hasCommits(repo)) throw new Error('El repositorio no tiene commits todavía: hacé un primer commit antes de usar Fleet');

  const created = [];
  if (!fs.existsSync(configPath(repo))) {
    saveConfig(repo, {
      baseBranch: currentBranch(repo),
      mode: mode || DEFAULTS.mode,
      maxConcurrent: DEFAULTS.maxConcurrent,
      maxAttempts: DEFAULTS.maxAttempts,
      checkCommand: check ?? detectCheckCommand(repo),
      planOnly: DEFAULTS.planOnly,
      maxAgentRunsPerDay: DEFAULTS.maxAgentRunsPerDay,
      limitPauseMin: DEFAULTS.limitPauseMin,
      models: DEFAULTS.models,
      permissionMode: DEFAULTS.permissionMode,
      allowedTools: DEFAULTS.allowedTools,
    });
    created.push(configPath(repo));
  }
  fs.mkdirSync(fleetDir(repo), { recursive: true });
  const ignored = ensureGitignore(repo, ['.fleet/', '.fleet-evidence/']);
  if (skills) copyMissing(path.join(TEMPLATES), path.join(repo, '.claude'), created);
  return { repo, created, ignored };
}
