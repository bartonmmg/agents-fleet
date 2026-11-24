import path from 'node:path';
import { fleetDir } from './config.mjs';
import { today, writeAtomic } from './util.mjs';

/** Informe "matutino": qué se mergeó, qué espera revisión, qué falló y cuánto costó. */
export function buildReport(store, hours = 24) {
  const since = Date.now() - hours * 3600_000;
  const data = store.load();
  const recent = (t) => new Date(t.updatedAt).getTime() >= since;
  const by = (status) => data.tasks.filter((t) => t.status === status);
  const merged = by('merged').filter((t) => t.mergedAt && new Date(t.mergedAt).getTime() >= since);
  const runs = data.costLog.filter((c) => new Date(c.at).getTime() >= since).length;

  const line = (t) => `- **#${t.id}** ${t.title}${t.area ? ` _(${t.area})_` : ''}`;
  const evidence = (t) => {
    const ev = t.verdicts?.verify?.evidence;
    return ev?.length ? `\n  - Evidencia: ${ev.slice(0, 3).join(' · ')}` : '';
  };

  return `# Informe Fleet — últimas ${hours} h (${new Date().toLocaleString()})

| Mergeadas | Listas para merge | Necesitan humano | En cola | Ejecuciones de agentes (plan) |
|---|---|---|---|---|
| ${merged.length} | ${by('ready_to_merge').length} | ${by('needs_human').length} | ${by('queued').length} | ${runs} |

## ✅ Mergeadas
${merged.map((t) => `${line(t)} → \`${(t.mergeCommit || '').slice(0, 8)}\`${evidence(t)}`).join('\n') || '_Ninguna._'}

## 👀 Listas para merge (revisá una muestra y corré \`fleet merge --all\`)
${by('ready_to_merge').map((t) => `${line(t)} · rama \`${t.branch}\`${evidence(t)}`).join('\n') || '_Ninguna._'}

## ⚠ Necesitan humano
${by('needs_human').filter(recent).map((t) => `${line(t)}\n  - ${String(t.error || '').split('\n')[0].slice(0, 300)}`).join('\n') || '_Ninguna._'}

## 🛡 Prevenciones sugeridas por los Code Reviewers
${data.tasks.filter(recent).flatMap((t) => (t.verdicts?.review || []).flatMap((r) => r.preventions || [])).map((p) => `- ${p}`).join('\n') || '_Ninguna._'}

> Consejo (Lauren Tan): muestreá PRs mergeados; cada corrección que tengas que hacer, convertila en una regla de lint/CI, no en una línea más de CLAUDE.md.
`;
}

export function writeReport(repo, store, hours) {
  const md = buildReport(store, hours);
  const file = path.join(fleetDir(repo), 'reports', `${today()}.md`);
  writeAtomic(file, md);
  return { md, file };
}
