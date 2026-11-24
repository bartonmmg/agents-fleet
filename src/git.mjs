import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fleetDir } from './config.mjs';

export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const res = { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  if (!res.ok && !allowFail) {
    throw new Error(`git ${args.join(' ')} falló en ${cwd}:\n${res.err || res.out}`);
  }
  return res;
}

export function isGitRepo(dir) {
  return git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).out === 'true';
}

export function repoRoot(dir) {
  return path.resolve(git(dir, ['rev-parse', '--show-toplevel']).out);
}

export function currentBranch(dir) {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
}

export function hasCommits(dir) {
  return git(dir, ['rev-parse', '--verify', 'HEAD'], { allowFail: true }).ok;
}

export function branchExists(repo, branch) {
  return git(repo, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFail: true }).ok;
}

export const taskBranch = (id) => `fleet/task-${id}`;
export const taskWorktree = (repo, id) => path.join(fleetDir(repo), 'worktrees', `task-${id}`);

/** Crea (o reutiliza) un worktree aislado para la tarea, en su propia rama desde la base. */
export function createWorktree(repo, id, base) {
  const branch = taskBranch(id);
  const wt = taskWorktree(repo, id);
  if (fs.existsSync(path.join(wt, '.git'))) return { branch, wt };
  git(repo, ['worktree', 'prune'], { allowFail: true });
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (branchExists(repo, branch)) {
    git(repo, ['worktree', 'add', wt, branch]);
  } else {
    git(repo, ['worktree', 'add', '-b', branch, wt, base]);
  }
  return { branch, wt };
}

export function removeWorktree(repo, id) {
  const wt = taskWorktree(repo, id);
  if (fs.existsSync(wt)) git(repo, ['worktree', 'remove', '--force', wt], { allowFail: true });
  git(repo, ['worktree', 'prune'], { allowFail: true });
  if (branchExists(repo, taskBranch(id))) git(repo, ['branch', '-D', taskBranch(id)], { allowFail: true });
}

export function isDirty(dir) {
  return git(dir, ['status', '--porcelain']).out.length > 0;
}

export function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message, '--no-verify'], { allowFail: true });
}

export function commitsAhead(dir, base) {
  return Number(git(dir, ['rev-list', '--count', `${base}..HEAD`]).out) || 0;
}

/** Cantidad de líneas tocadas (agregadas + borradas) respecto de la base. */
export function diffLines(dir, base) {
  const out = git(dir, ['diff', '--numstat', `${base}...HEAD`]).out;
  return out.split('\n').filter(Boolean).reduce((sum, line) => {
    const [a, d] = line.split('\t');
    return sum + (Number(a) || 0) + (Number(d) || 0);
  }, 0);
}

export function diffStat(dir, base) {
  return git(dir, ['diff', '--stat', `${base}...HEAD`]).out;
}

/** Ej.: "2 files changed, 18 insertions(+), 4 deletions(-)" */
export function shortStat(dir, base, ref = 'HEAD') {
  return git(dir, ['diff', '--shortstat', `${base}...${ref}`], { allowFail: true }).out;
}

/** Diff unificado de una rama contra la base (para el visor de cambios de Studio). */
export function branchDiff(repo, base, branch) {
  if (!branchExists(repo, branch)) return '';
  return git(repo, ['diff', '--no-color', `${base}...${branch}`], { allowFail: true }).out;
}

/** Identidad local de git configurada en el repo (no la global). */
export function localIdentity(repo) {
  return {
    name: git(repo, ['config', '--local', 'user.name'], { allowFail: true }).out,
    email: git(repo, ['config', '--local', 'user.email'], { allowFail: true }).out,
  };
}
