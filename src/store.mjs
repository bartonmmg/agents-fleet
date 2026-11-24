import fs from 'node:fs';
import path from 'node:path';
import { fleetDir } from './config.mjs';
import { now, today, writeAtomic } from './util.mjs';

/**
 * Estados de una tarea:
 *   proposed (sugerida por el Product Manager) → queued al aprobarla | declined al descartarla
 *   queued → running → ready_to_merge → merging → merged
 *                    ↘ needs_human (agotó intentos o necesita decisión)
 *   cancelled (manual)
 */
export const STATUSES = ['proposed', 'declined', 'queued', 'running', 'ready_to_merge', 'merging', 'merged', 'needs_human', 'cancelled'];

export class Store {
  constructor(repo) {
    this.repo = repo;
    this.file = path.join(fleetDir(repo), 'tasks.json');
  }

  load() {
    if (!fs.existsSync(this.file)) return { nextId: 1, tasks: [], costLog: [] };
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    data.costLog ||= [];
    return data;
  }

  save(data) {
    writeAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`);
    try { this.onChange?.(); } catch { /* un observador roto no debe frenar al motor */ }
  }

  /** Registra el inicio de un paso visible (un rol trabajando sobre la tarea). */
  startStep(id, { key, role, stage }) {
    const data = this.load();
    const task = data.tasks.find((t) => t.id === Number(id));
    if (!task) return;
    task.steps ||= [];
    task.steps.push({ key, role, stage, status: 'running', summary: '', startedAt: now(), endedAt: null });
    task.updatedAt = now();
    this.save(data);
  }

  /** Cierra el último paso con esa clave: status ok | fail | paused. */
  finishStep(id, key, { status, summary = '' }) {
    const data = this.load();
    const task = data.tasks.find((t) => t.id === Number(id));
    const step = task?.steps?.findLast((s) => s.key === key);
    if (!step) return;
    Object.assign(step, { status, summary: String(summary).slice(0, 1200), endedAt: now() });
    task.updatedAt = now();
    this.save(data);
  }

  all() { return this.load().tasks; }

  get(id) {
    const task = this.all().find((t) => t.id === Number(id));
    if (!task) throw new Error(`No existe la tarea #${id}`);
    return task;
  }

  add({ title, description = '', area = null, priority = 2, source = 'manual', sourceKey = null, status = 'queued', category = null, risk = null, rationale = null, acceptance = null }) {
    const data = this.load();
    if (sourceKey && data.tasks.some((t) => t.sourceKey === sourceKey)) return null;
    const task = {
      id: data.nextId++,
      title,
      description,
      area,
      priority: Number(priority) || 2,
      status,
      category,
      risk,
      rationale,
      acceptance,
      stage: null,
      attempts: 0,
      plan: null,
      feedback: null,
      branch: null,
      worktree: null,
      verdicts: {},
      steps: [],
      costUsd: 0,
      source,
      sourceKey,
      createdAt: now(),
      updatedAt: now(),
      history: [{ at: now(), msg: status === 'proposed' ? 'propuesta por el Product Manager' : 'creada' }],
    };
    data.tasks.push(task);
    this.save(data);
    return task;
  }

  update(id, patch, historyMsg) {
    const data = this.load();
    const task = data.tasks.find((t) => t.id === Number(id));
    if (!task) throw new Error(`No existe la tarea #${id}`);
    Object.assign(task, patch, { updatedAt: now() });
    if (historyMsg) task.history.push({ at: now(), msg: historyMsg });
    this.save(data);
    return task;
  }

  /** Registra una ejecución de agente. `usd` es el costo equivalente informado (con el plan no se cobra). */
  addRun(taskId, stage, usd = 0) {
    const data = this.load();
    data.costLog.push({ at: now(), taskId, stage, usd: usd || 0 });
    const task = data.tasks.find((t) => t.id === taskId);
    if (task) task.costUsd = Math.round((task.costUsd + (usd || 0)) * 10000) / 10000;
    this.save(data);
  }

  runsToday() {
    const d = today();
    return this.load().costLog.filter((c) => c.at.startsWith(d)).length;
  }

  costToday() {
    const d = today();
    return this.load().costLog.filter((c) => c.at.startsWith(d)).reduce((s, c) => s + c.usd, 0);
  }
}
