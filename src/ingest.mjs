import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * Importa tareas desde un markdown con checklist:
 *   - [ ] Título de la tarea #area !1
 *     descripción opcional indentada
 * `#area` agrupa (dos tareas de la misma área no corren en paralelo); `!1` = prioridad alta.
 */
export function parseTodos(markdown) {
  const tasks = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\[ \]\s+(.+)$/);
    if (m) {
      let title = m[1];
      const area = title.match(/(?:^|\s)#([\w./-]+)/)?.[1] ?? null;
      const prio = title.match(/(?:^|\s)!([123])\b/)?.[1];
      title = title.replace(/(?:^|\s)#[\w./-]+/g, '').replace(/(?:^|\s)![123]\b/g, '').trim();
      current = { title, area, priority: prio ? Number(prio) : 2, description: '' };
      tasks.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.description += `${line.trim()}\n`;
    } else if (line.trim() === '' || /^\s*[-*]\s+\[x\]/i.test(line)) {
      current = null;
    }
  }
  return tasks.map((t) => ({ ...t, description: t.description.trim() }));
}

export function importTodosFile(store, file) {
  const parsed = parseTodos(fs.readFileSync(file, 'utf8'));
  return parsed
    .map((t) => store.add({ ...t, source: 'todos', sourceKey: `todos:${t.title}` }))
    .filter(Boolean);
}

/** Importa issues abiertos de GitHub con una etiqueta (usa la CLI `gh`, ya autenticada). */
export function importGithub(store, repo, label = 'fleet') {
  const r = spawnSync('gh', ['issue', 'list', '--state', 'open', '--label', label, '--limit', '100', '--json', 'number,title,body,labels'], {
    cwd: repo, encoding: 'utf8', windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`gh issue list falló: ${r.stderr || r.error?.message || 'gh no está instalado'}`);
  const issues = JSON.parse(r.stdout || '[]');
  return issues
    .map((i) => store.add({
      title: `${i.title} (issue #${i.number})`,
      description: `${i.body || ''}\n\nCerrá el issue #${i.number} en el mensaje de commit ("Fixes #${i.number}").`,
      area: i.labels.map((l) => l.name).find((n) => n.startsWith('area:'))?.slice(5) ?? null,
      priority: i.labels.some((l) => l.name === 'p1') ? 1 : 2,
      source: 'github',
      sourceKey: `gh:${i.number}`,
    }))
    .filter(Boolean);
}
