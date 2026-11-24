import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { applyGitIdentity, configPath, loadConfig, readRawConfig, saveConfig } from '../config.mjs';
import { Store } from '../store.mjs';
import { detectCheckCommand, initRepo } from '../init.mjs';
import { runFleet } from '../scheduler.mjs';
import { mergeTask } from '../merge.mjs';
import { activityFile, runDirOf, stopFile } from '../pipeline.mjs';
import { branchDiff, hasCommits, isGitRepo, localIdentity, removeWorktree, repoRoot } from '../git.mjs';
import { buildReport } from '../report.mjs';
import { runAudit } from '../audit.mjs';
import { log, writeAtomic } from '../util.mjs';

/** Permite despertar al loop del scheduler (nueva tarea, pausa) sin esperar el polling. */
export class Notifier {
  constructor() { this.waiters = []; }
  wait() { return new Promise((r) => this.waiters.push(r)); }
  notify() { const w = this.waiters; this.waiters = []; w.forEach((r) => r()); }
}

const EDITABLE = ['mode', 'maxConcurrent', 'maxAttempts', 'checkCommand', 'maxAgentRunsPerDay', 'limitPauseMin', 'models', 'gitAuthor', 'stageTimeoutMin'];

/**
 * Motor de Fleet Studio: un proyecto abierto a la vez, la flota corriendo en segundo plano
 * y eventos 'state' / 'activity' para la interfaz.
 */
export class Engine extends EventEmitter {
  constructor({ home }) {
    super();
    this.home = home;
    this.ctx = null;
    this.running = null;
    this.wakeup = new Notifier();
    this.recentFile = path.join(home, 'projects.json');
  }

  // ---------- proyectos ----------

  recentProjects() {
    try { return JSON.parse(fs.readFileSync(this.recentFile, 'utf8')).filter((p) => fs.existsSync(configPath(p.path))); } catch { return []; }
  }

  remember(repo) {
    const list = this.recentProjects().filter((p) => p.path !== repo);
    list.unshift({ path: repo, name: path.basename(repo), openedAt: new Date().toISOString() });
    writeAtomic(this.recentFile, JSON.stringify(list.slice(0, 10), null, 2));
  }

  /** Abre un proyecto. Si no está preparado para Fleet devuelve lo necesario para el asistente. */
  open(dir) {
    if (this.running) throw new Error('Pausá la flota antes de cambiar de proyecto.');
    if (!dir || !fs.existsSync(dir)) throw new Error('Esa carpeta no existe.');
    if (!isGitRepo(dir)) throw new Error('Esa carpeta no es un repositorio git. Fleet trabaja sobre proyectos con git.');
    const repo = repoRoot(dir);
    if (!hasCommits(repo)) throw new Error('El repositorio no tiene commits todavía: hacé un primer commit antes de usar Fleet.');
    if (!fs.existsSync(configPath(repo))) {
      return { needsInit: true, repo, suggestion: { checkCommand: detectCheckCommand(repo), gitAuthor: localIdentity(repo) } };
    }
    this.load(repo);
    return { opened: true, repo };
  }

  init({ path: dir, checkCommand, gitName, gitEmail, mode }) {
    if (this.running) throw new Error('Pausá la flota antes de cambiar de proyecto.');
    const gitAuthor = gitName && gitEmail ? { name: gitName.trim(), email: gitEmail.trim() } : undefined;
    const { repo } = initRepo(dir, { check: checkCommand ?? undefined, mode, gitAuthor });
    this.load(repo);
    return { opened: true, repo };
  }

  load(repo) {
    const cfg = loadConfig(repo);
    applyGitIdentity(cfg);
    const store = new Store(repo);
    let timer = null;
    store.onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.emit('state'), 120);
    };
    this.ctx = { repo, cfg, store, wakeup: this.wakeup, onActivity: (e) => this.emit('activity', e) };
    this.remember(repo);
    this.emit('state');
  }

  requireProject() {
    if (!this.ctx) throw new Error('No hay ningún proyecto abierto.');
    return this.ctx;
  }

  updateConfig(patch = {}) {
    const { repo, cfg } = this.requireProject();
    const raw = readRawConfig(repo);
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      const v = patch[key];
      raw[key] = (key === 'models' || key === 'gitAuthor') ? { ...(raw[key] || {}), ...v } : v;
    }
    for (const k of ['maxConcurrent', 'maxAttempts', 'maxAgentRunsPerDay', 'limitPauseMin', 'stageTimeoutMin']) {
      if (k in raw) raw[k] = Math.max(1, Math.round(Number(raw[k]) || 1));
    }
    if (raw.mode !== 'auto') raw.mode = 'supervised';
    saveConfig(repo, raw);
    Object.assign(cfg, loadConfig(repo));
    applyGitIdentity(cfg);
    this.wakeup.notify();
    this.emit('state');
  }

  // ---------- flota ----------

  start() {
    const ctx = this.requireProject();
    fs.rmSync(stopFile(ctx.repo), { force: true });
    if (!this.running) {
      this.running = runFleet(ctx, { watch: true })
        .catch((e) => log(`Fleet: ${e.message}`))
        .finally(() => { this.running = null; this.emit('state'); });
    }
    this.wakeup.notify();
    this.emit('state');
  }

  pause() {
    const { repo } = this.requireProject();
    fs.writeFileSync(stopFile(repo), new Date().toISOString());
    this.wakeup.notify();
    this.emit('state');
  }

  // ---------- tareas ----------

  addTask({ title, description = '', area = '', priority = 2 }) {
    const { store } = this.requireProject();
    if (!title || !String(title).trim()) throw new Error('La tarea necesita un título.');
    const t = store.add({ title: String(title).trim(), description: String(description).trim(), area: String(area).trim() || null, priority: Number(priority) || 2 });
    this.wakeup.notify();
    return t;
  }

  task(id) { return this.requireProject().store.get(id); }

  async approve(id) {
    const ctx = this.requireProject();
    const res = await mergeTask(ctx, Number(id));
    this.wakeup.notify();
    return res;
  }

  requestChanges(id, feedback) {
    const { store } = this.requireProject();
    const t = store.get(id);
    if (!['ready_to_merge', 'needs_human'].includes(t.status)) throw new Error('Solo se pueden pedir cambios a tareas listas o que necesitan ayuda.');
    if (!feedback || !String(feedback).trim()) throw new Error('Escribí qué hay que cambiar.');
    store.update(t.id, { status: 'queued', attempts: 0, error: null, feedback: `Pedido de cambios del usuario:\n${String(feedback).trim()}` }, 'cambios pedidos por el usuario');
    this.wakeup.notify();
  }

  retry(id) {
    const { store } = this.requireProject();
    const t = store.get(id);
    if (t.status === 'running' || t.status === 'merging') throw new Error('La tarea está en curso.');
    store.update(t.id, { status: 'queued', attempts: 0, error: null }, 'reintentada por el usuario');
    this.wakeup.notify();
  }

  cancel(id) {
    const { repo, store } = this.requireProject();
    const t = store.get(id);
    if (t.status === 'running' || t.status === 'merging') throw new Error('La tarea está en curso: pausá la flota y cancelala cuando se detenga.');
    removeWorktree(repo, t.id);
    store.update(t.id, { status: 'cancelled', worktree: null, stage: null }, 'cancelada por el usuario');
  }

  diff(id) {
    const { repo, cfg, store } = this.requireProject();
    const t = store.get(id);
    const saved = path.join(runDirOf(repo, t.id), 'changes.diff');
    const live = t.branch ? branchDiff(repo, cfg.baseBranch, t.branch) : '';
    if (live) return live;
    return fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8') : '';
  }

  activity(id, limit = 300) {
    const { repo } = this.requireProject();
    const file = activityFile(repo, Number(id));
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  evidence(id) {
    const { repo } = this.requireProject();
    const dir = path.join(runDirOf(repo, Number(id)), 'evidence');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  }

  evidencePath(id, file) {
    const { repo } = this.requireProject();
    return path.join(runDirOf(repo, Number(id)), 'evidence', path.basename(file));
  }

  report(hours = 24) { return buildReport(this.requireProject().store, hours); }

  audit(days = 7) { return runAudit(this.requireProject(), days); }

  // ---------- estado para la UI ----------

  state() {
    if (!this.ctx) return { project: null, recent: this.recentProjects() };
    const { repo, cfg, store } = this.ctx;
    return {
      project: { repo, name: path.basename(repo) },
      running: Boolean(this.running),
      stopped: fs.existsSync(stopFile(repo)),
      runsToday: store.runsToday(),
      config: {
        mode: cfg.mode, maxConcurrent: cfg.maxConcurrent, maxAttempts: cfg.maxAttempts,
        checkCommand: cfg.checkCommand, maxAgentRunsPerDay: cfg.maxAgentRunsPerDay,
        limitPauseMin: cfg.limitPauseMin, stageTimeoutMin: cfg.stageTimeoutMin,
        models: cfg.models, gitAuthor: cfg.gitAuthor, baseBranch: cfg.baseBranch, planOnly: cfg.planOnly !== false,
      },
      tasks: store.all().map(({ plan, history, ...t }) => ({ ...t, hasPlan: Boolean(plan), lastEvent: history?.at(-1) || null })),
      recent: this.recentProjects(),
    };
  }
}
