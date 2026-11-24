import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from './git.mjs';
import { tail } from './util.mjs';

const TEXT_EXT = /\.(md|txt|log|json|csv|ndjson|jsonl)$/i;

/** Lee un archivo o los archivos más recientes de una carpeta (solo texto), recortado. */
export function readSignalPath(repo, rel, maxChars = 8000) {
  if (!rel) return '';
  const abs = path.resolve(repo, rel);
  if (!fs.existsSync(abs)) return `(no existe ${rel})`;
  const stat = fs.statSync(abs);
  if (stat.isFile()) return tail(fs.readFileSync(abs, 'utf8'), maxChars);
  const files = fs.readdirSync(abs)
    .filter((f) => TEXT_EXT.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(abs, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 5);
  const per = Math.floor(maxChars / Math.max(files.length, 1));
  return files.map(({ f }) => `--- ${f}\n${tail(fs.readFileSync(path.join(abs, f), 'utf8'), per)}`).join('\n') || '(carpeta vacía)';
}

/** owner/repo a partir del remote origin de GitHub, o null. */
export function githubRepoOf(repo) {
  const url = git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }).out;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const formatIssues = (issues) => issues.slice(0, 30)
  .map((i) => `#${i.number} ${i.title}${i.labels?.length ? ` [${i.labels.map((l) => l.name || l).join(', ')}]` : ''}\n${String(i.body || '').slice(0, 400)}`)
  .join('\n\n');

/** Issues abiertos de GitHub: primero con la CLI `gh` (si está), si no con la API pública. */
export async function readGithubIssues(repo) {
  const gh = spawnSync('gh', ['issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,body,labels'], { cwd: repo, encoding: 'utf8', windowsHide: true });
  if (gh.status === 0) {
    try { return formatIssues(JSON.parse(gh.stdout || '[]')) || '(sin issues abiertos)'; } catch { /* sigue con la API */ }
  }
  const slug = githubRepoOf(repo);
  if (!slug) return '(el repo no tiene un remote de GitHub)';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/issues?state=open&per_page=30`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'fleet-agents', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return `(no se pudieron leer los issues: HTTP ${res.status}${res.status === 404 ? ', ¿repo privado? instalá gh o definí GITHUB_TOKEN' : ''})`;
    const issues = (await res.json()).filter((i) => !i.pull_request);
    return formatIssues(issues) || '(sin issues abiertos)';
  } catch (e) {
    return `(no se pudieron leer los issues: ${e.message})`;
  }
}

/** Junta todas las señales configuradas para el Product Manager. */
export async function collectSignals(repo, cfg) {
  const s = cfg.signals || {};
  return {
    github: s.github ? await readGithubIssues(repo) : null,
    errors: s.errorsPath ? readSignalPath(repo, s.errorsPath) : null,
    feedback: s.feedbackPath ? readSignalPath(repo, s.feedbackPath) : null,
  };
}
