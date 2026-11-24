import path from 'node:path';
import { fleetDir } from './config.mjs';
import { git } from './git.mjs';
import { runAgent } from './runner.mjs';
import { auditPrompt } from './prompts.mjs';
import { today, writeAtomic } from './util.mjs';

/** Auditor de calidad: lee los commits recientes y propone defensas contra malas prácticas repetidas. No edita el repo. */
export async function runAudit({ repo, cfg, store }, days = 7) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const commits = git(repo, ['log', '--oneline', `--since=${since}`, cfg.baseBranch]).out;
  const res = await runAgent({
    cfg, cwd: repo, stage: 'audit', taskId: 0, readOnly: true,
    prompt: auditPrompt(cfg, since, commits),
    model: cfg.models.audit, maxTurns: cfg.maxTurns.audit,
    logFile: path.join(fleetDir(repo), 'runs', 'audit', `${Date.now()}.log`),
  });
  store.addRun(0, 'audit', res.costUsd);
  if (res.limited) throw new Error('Se alcanzó el límite de uso de tu plan. Probá de nuevo cuando se renueve.');
  const file = path.join(fleetDir(repo), 'audits', `${today()}.md`);
  writeAtomic(file, res.text || '(sin salida)');
  return { ok: res.ok, file, text: res.text };
}
