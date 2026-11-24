import fs from 'node:fs';
import path from 'node:path';
import { fleetDir } from './config.mjs';
import { currentBranch, git, isDirty, removeWorktree } from './git.mjs';
import { log, runShell, sleep, tail } from './util.mjs';

const LOCK_STALE_MS = 15 * 60_000;
const lockFile = (repo) => path.join(fleetDir(repo), 'merge.lock');

/** Lock de archivo: los merges a la rama base se hacen de a uno, aunque haya varios procesos. */
async function withMergeLock(repo, fn, waitMs = 10 * 60_000) {
  const file = lockFile(repo);
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const age = Date.now() - fs.statSync(file).mtimeMs;
      if (age > LOCK_STALE_MS) { fs.rmSync(file, { force: true }); continue; }
      if (Date.now() - start > waitMs) throw new Error('Timeout esperando el lock de merge');
      await sleep(2000);
    }
  }
  try { return await fn(); } finally { fs.rmSync(file, { force: true }); }
}

/**
 * Integra una tarea lista: rebase sobre la base, re-corre el check y hace merge fast-forward.
 * Si hay conflicto, la tarea vuelve a la cola desde cero sobre la base actualizada.
 */
/** Deshace los commits before..after con un único commit de revert. Devuelve el sha o null. */
function revertRange(repo, before, after, taskId) {
  const r = git(repo, ['revert', '--no-commit', `${before}..${after}`], { allowFail: true });
  if (!r.ok) { git(repo, ['revert', '--abort'], { allowFail: true }); return null; }
  const c = git(repo, ['commit', '--no-verify', '-m', `revert: tarea #${taskId} (falló el control de salud de Autopilot)`], { allowFail: true });
  if (!c.ok) { git(repo, ['revert', '--abort'], { allowFail: true }); return null; }
  return git(repo, ['rev-parse', 'HEAD']).out;
}

export async function mergeTask(ctx, taskId, { auto = false } = {}) {
  const { repo, cfg, store } = ctx;
  return withMergeLock(repo, async () => {
    const task = store.get(taskId);
    if (task.status !== 'ready_to_merge') throw new Error(`La tarea #${taskId} está en "${task.status}", no en ready_to_merge`);
    const base = cfg.baseBranch;
    const wt = task.worktree;

    if (currentBranch(repo) !== base) {
      throw new Error(`El repo principal tiene que estar en "${base}" para mergear (está en "${currentBranch(repo)}")`);
    }
    store.update(taskId, { status: 'merging' }, 'merge: rebase');

    const rebase = git(wt, ['rebase', base], { allowFail: true });
    if (!rebase.ok) {
      git(wt, ['rebase', '--abort'], { allowFail: true });
      removeWorktree(repo, taskId);
      store.update(taskId, {
        status: 'queued', attempts: 0, worktree: null, branch: null,
        feedback: `Conflicto al integrar con ${base}. Rehacé la tarea sobre la versión actual de ${base}.`,
      }, 'conflicto de rebase: vuelve a la cola');
      log(`#${taskId} ↺ conflicto con ${base}, vuelve a la cola`);
      return 'requeued';
    }

    if (cfg.checkCommand) {
      const check = await runShell(cfg.checkCommand, wt, cfg.checkTimeoutMin * 60_000);
      if (!check.ok) {
        store.update(taskId, {
          status: 'queued', attempts: 0,
          feedback: `Después de rebasear sobre ${base}, \`${cfg.checkCommand}\` falla:\n${tail(check.output, 3000)}`,
        }, 'check falló tras rebase: vuelve a la cola');
        return 'requeued';
      }
    }

    const before = git(repo, ['rev-parse', 'HEAD']).out;
    const merge = git(repo, ['merge', '--ff-only', task.branch], { allowFail: true });
    if (!merge.ok) {
      const dirty = isDirty(repo) ? ' (el repo principal tiene cambios sin commitear)' : '';
      store.update(taskId, { status: 'needs_human', error: `merge falló${dirty}: ${merge.err}` }, 'merge falló');
      return 'needs_human';
    }
    const sha = git(repo, ['rev-parse', 'HEAD']).out;
    const mergedBy = auto ? 'autopilot' : 'usuario';

    // Control de salud: un chequeo más amplio (build, e2e, smoke) sobre la rama base ya integrada.
    const health = cfg.policy?.healthCommand;
    if (health) {
      const h = await runShell(health, repo, cfg.checkTimeoutMin * 60_000);
      if (!h.ok) {
        const reverted = revertRange(repo, before, sha, taskId);
        removeWorktree(repo, taskId);
        const why = `El control de salud (\`${health}\`) falló después de integrar.${reverted ? ' Se revirtió el cambio automáticamente.' : ' ⚠ NO se pudo revertir solo: revisá la rama base.'}\n${tail(h.output, 2500)}`;
        store.update(taskId, { status: 'needs_human', worktree: null, error: why, feedback: why, reverted: Boolean(reverted), revertCommit: reverted || null }, reverted ? `revertida: falló el control de salud (${reverted.slice(0, 8)})` : 'falló el control de salud y no se pudo revertir');
        log(`#${taskId} ⟲ control de salud falló${reverted ? `, revertida en ${reverted.slice(0, 8)}` : ', NO se pudo revertir'}`);
        return reverted ? 'reverted' : 'needs_human';
      }
    }

    removeWorktree(repo, taskId);
    store.update(taskId, { status: 'merged', mergedAt: new Date().toISOString(), mergeCommit: sha, mergedBy, worktree: null }, `integrada en ${base} (${sha.slice(0, 8)}) por ${mergedBy}`);
    log(`#${taskId} ⇢ integrada en ${base} ${sha.slice(0, 8)} (${mergedBy})`);
    return 'merged';
  });
}
