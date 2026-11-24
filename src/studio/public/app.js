const TOKEN = document.querySelector('meta[name="fleet-token"]').content;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- íconos (SVG inline, sin dependencias) ----------
const ICONS = {
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 6c5 0 8 2 8 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  git: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4-6 3-10 6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  report: '<path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6"/>',
  pause2: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- estado ----------
const S = { state: null, selected: null, task: null, activity: [], diff: null, connected: false };

const COLUMNS = [
  { key: 'queued', label: 'En cola', statuses: ['queued'], empty: 'Agregá una tarea para empezar.' },
  { key: 'running', label: 'Trabajando', statuses: ['running', 'merging'], empty: 'Ningún agente trabajando.' },
  { key: 'ready', label: 'Para aprobar', statuses: ['ready_to_merge'], empty: 'Nada para revisar todavía.' },
  { key: 'help', label: 'Necesita tu ayuda', statuses: ['needs_human'], empty: 'Todo en orden.' },
  { key: 'merged', label: 'Integradas', statuses: ['merged'], empty: 'Todavía no se integró nada.' },
];
const STATUS = {
  queued: ['En cola', 'b-neutral'], running: ['Trabajando', 'b-run'], merging: ['Integrando', 'b-run'],
  ready_to_merge: ['Lista para aprobar', 'b-ok'], needs_human: ['Necesita tu ayuda', 'b-bad'],
  merged: ['Integrada', 'b-ok'], cancelled: ['Cancelada', 'b-neutral'],
};
const STAGE_LABEL = { plan: 'planifica', execute: 'implementa', check: 'automáticos', verify: 'verifica', review: 'revisa el código' };

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-fleet-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
}

// ---------- tiempo real ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    S.state = JSON.parse(e.data);
    S.connected = true;
    render();
    // Solo se recarga el panel si cambió la tarea abierta (evita que los botones "salten").
    const sel = S.selected && S.state.tasks?.find((t) => t.id === S.selected);
    if (S.selected && (!sel || sel.updatedAt !== S.task?.updatedAt)) refreshTask();
  });
  es.addEventListener('activity', (e) => {
    const ev = JSON.parse(e.data);
    if (ev.taskId === S.selected) {
      S.activity.push(ev);
      if (S.activity.length > 400) S.activity.shift();
      renderActivity();
    }
  });
  es.onerror = () => { S.connected = false; renderTopbar(); };
}

// ---------- render general ----------
function render() {
  renderTopbar();
  if (!S.state?.project) renderWelcome();
  else renderBoard();
}

function renderTopbar() {
  const st = S.state;
  const p = st?.project;
  let html = `<div class="brand"><div class="logo">${icon('spark')}</div>Fleet Studio</div>`;
  if (p) {
    const working = st.tasks.filter((t) => t.status === 'running' || t.status === 'merging').length;
    const live = st.running && !st.stopped;
    const flota = !S.connected ? ['Sin conexión', 'paused'] : live ? ['En marcha', 'live'] : st.running ? ['Pausando…', 'paused'] : ['Detenida', ''];
    html += `
      <button class="ghost project-btn" data-action="projects" title="${esc(p.repo)}">${icon('folder')} ${esc(p.name)}</button>
      <span class="pill ${flota[1]}"><span class="dot"></span>${flota[0]}</span>
      <span class="pill">${st.config.mode === 'auto' ? 'Automático' : 'Supervisado'}</span>
      <span class="pill">${working} trabajando · máx. ${st.config.maxConcurrent}</span>
      <span class="pill" title="Ejecuciones de agentes hoy. Usa tu plan de Claude, sin costo extra.">Plan: ${st.runsToday} / ${st.config.maxAgentRunsPerDay} hoy</span>
      <span class="spacer"></span>
      <button data-action="new-task">${icon('plus')} Nueva tarea</button>
      ${live
    ? `<button data-action="pause">${icon('pause')} Pausar</button>`
    : `<button class="primary" data-action="start" ${st.running ? 'disabled' : ''}>${icon('play')} Iniciar</button>`}
      <button class="ghost" data-action="report" title="Informe">${icon('report')}</button>
      <button class="ghost" data-action="settings" title="Configuración">${icon('gear')}</button>`;
  } else {
    html += '<span class="spacer"></span>';
  }
  $('#topbar').innerHTML = html;
}

function renderWelcome() {
  const recent = S.state?.recent || [];
  $('#main').innerHTML = `
  <div class="welcome">
    <h1>Tu equipo de agentes de código</h1>
    <p class="lead">Cargás tareas, los agentes las resuelven en copias aparte de tu proyecto, se controlan entre ellos y vos aprobás lo que entra. Usa solo tu plan de Claude.</p>
    <div class="choices">
      <div class="choice">
        <span class="badge b-run">Recomendado para empezar</span>
        <h3>Probar con la tienda demo</h3>
        <p>Un proyecto chico con 4 errores a propósito y sus tareas ya cargadas. Ideal para ver cómo trabajan los agentes.</p>
        <button class="primary" data-action="demo">${icon('spark')} Crear demo</button>
      </div>
      <div class="choice">
        <h3>Abrir un proyecto</h3>
        <p>Elegí la carpeta de un proyecto tuyo con git. Si es la primera vez, te ayudo a prepararlo.</p>
        <button data-action="projects">${icon('folder')} Elegir carpeta</button>
      </div>
    </div>
    ${recent.length ? `<div class="recent"><h4>Recientes</h4>${recent.map((r) => `
      <div class="fsrow" data-action="open-recent" data-path="${esc(r.path)}">${icon('folder')}<span class="name">${esc(r.name)} <span class="hint">${esc(r.path)}</span></span></div>`).join('')}</div>` : ''}
    <div class="roles">
      <div class="role"><b>Tech Lead</b><span>Lee el código y arma el plan</span></div>
      <div class="role"><b>Developer</b><span>Implementa en una copia aparte</span></div>
      <div class="role"><b>Tests</b><span>Fleet corre tus tests</span></div>
      <div class="role"><b>QA Verifier</b><span>Prueba que funcione</span></div>
      <div class="role"><b>Code Reviewer</b><span>Busca errores y desprolijidades</span></div>
    </div>
  </div>`;
}

function currentStep(t) {
  return (t.steps || []).findLast((s) => s.status === 'running');
}

function cardHtml(t) {
  const step = currentStep(t);
  let badge = '';
  if (t.status === 'running' && step) badge = `<span class="badge b-run"><span class="pulse"></span>${esc(step.role)} ${esc(STAGE_LABEL[step.stage] || 'trabajando')}</span>`;
  else if (t.status === 'running') badge = '<span class="badge b-run"><span class="pulse"></span>Preparando</span>';
  else if (t.status === 'merging') badge = '<span class="badge b-run"><span class="pulse"></span>Integrando</span>';
  else if (t.status === 'ready_to_merge') badge = `<span class="badge b-ok">${icon('check')} Verificada y revisada</span>`;
  else if (t.status === 'needs_human') badge = `<span class="badge b-bad">${icon('alert')} Falló ${t.attempts} ${t.attempts === 1 ? 'vez' : 'veces'}</span>`;
  else if (t.status === 'queued' && t.feedback) badge = `<span class="badge b-warn">${icon('refresh')} Con correcciones</span>`;
  return `<div class="card ${t.priority === 1 ? 'prio-1' : ''} ${S.selected === t.id ? 'selected' : ''}" tabindex="0" data-task="${t.id}">
    <div class="title">${esc(t.title)}</div>
    <div class="meta">${t.area ? `<span class="tag">${esc(t.area)}</span>` : ''}<span>#${t.id}</span>${badge}</div>
  </div>`;
}

function renderBoard() {
  const st = S.state;
  const tasks = st.tasks;
  const hasQueued = tasks.some((t) => t.status === 'queued');
  let hint = '';
  if (!tasks.length) hint = `<div class="hint-bar">${icon('plus')} Empezá cargando una tarea chica y concreta. <button data-action="new-task">Nueva tarea</button></div>`;
  else if (hasQueued && !st.running) hint = `<div class="hint-bar">${icon('play')} Hay tareas en cola. Tocá <b>Iniciar</b> y los agentes empiezan a trabajar. <button class="primary" data-action="start">Iniciar</button></div>`;
  $('#main').innerHTML = `${hint}<div class="board">${COLUMNS.map((c) => {
    let list = tasks.filter((t) => c.statuses.includes(t.status));
    list = c.key === 'merged' ? list.sort((a, b) => b.id - a.id).slice(0, 15) : list.sort((a, b) => a.priority - b.priority || a.id - b.id);
    return `<section class="column"><h2>${c.label}<span class="count">${tasks.filter((t) => c.statuses.includes(t.status)).length}</span></h2>
      ${list.length ? list.map(cardHtml).join('') : `<div class="empty">${c.empty}</div>`}</section>`;
  }).join('')}</div>`;
}

// ---------- detalle de tarea ----------
async function openTask(id) {
  S.selected = Number(id);
  S.diff = null;
  S.activity = [];
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
  renderBoard();
  await refreshTask();
  S.activity = await api('GET', `/api/tasks/${id}/activity`).catch(() => []);
  renderActivity();
}

function closeTask() {
  S.selected = null;
  S.task = null;
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
  if (S.state?.project) renderBoard();
}

let refreshing = null;
async function refreshTask() {
  if (!S.selected) return;
  if (refreshing) return refreshing;
  refreshing = api('GET', `/api/tasks/${S.selected}`)
    .then((t) => { S.task = t; renderDrawer(); })
    .catch(() => closeTask())
    .finally(() => { refreshing = null; });
  return refreshing;
}

function stepIcon(status) {
  return { ok: icon('check'), fail: icon('x'), running: '<span class="pulse"></span>', paused: icon('pause2') }[status] || icon('clock');
}

function renderDrawer() {
  const t = S.task;
  if (!t) return;
  const max = S.state?.config?.maxAttempts ?? 2;
  const [label, cls] = STATUS[t.status] || [t.status, 'b-neutral'];
  const actions = [];
  if (t.status === 'ready_to_merge') {
    actions.push(`<button class="good" data-action="approve">${icon('merge')} Aprobar e integrar</button>`);
    actions.push(`<button data-action="request-changes">${icon('edit')} Pedir cambios</button>`);
  }
  if (t.status === 'needs_human') {
    actions.push(`<button data-action="retry">${icon('refresh')} Reintentar</button>`);
    actions.push(`<button data-action="request-changes">${icon('edit')} Reintentar con indicaciones</button>`);
  }
  if (['queued', 'ready_to_merge', 'needs_human'].includes(t.status)) actions.push(`<button class="danger" data-action="cancel">${icon('x')} Cancelar</button>`);
  if (t.branch || t.status === 'merged') actions.push(`<button data-action="diff">${icon('eye')} Ver cambios</button>`);

  const steps = t.steps || [];
  const running = t.status === 'running' || t.status === 'merging';
  $('#drawer').innerHTML = `
    <header>
      <div class="row"><h2>${esc(t.title)}</h2><button class="ghost" data-action="close" aria-label="Cerrar">${icon('x')}</button></div>
      <div class="sub"><span class="badge ${cls}">${label}</span><span>#${t.id}</span>${t.area ? `<span class="tag">${esc(t.area)}</span>` : ''}
        <span>Prioridad ${t.priority === 1 ? 'alta' : t.priority === 3 ? 'baja' : 'normal'}</span><span>Intento ${t.attempts}/${max}</span></div>
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
    </header>
    ${t.description ? `<section><h3>Descripción</h3><div class="desc">${esc(t.description)}</div></section>` : ''}
    ${t.status === 'needs_human' && t.error ? `<section><h3>${icon('alert')} Por qué necesita tu ayuda</h3><div class="error-box">${esc(t.error)}</div></section>` : ''}
    ${t.status === 'queued' && t.feedback ? `<section><h3>${icon('edit')} Correcciones pendientes</h3><div class="error-box" style="background:var(--warn-bg);color:var(--warn)">${esc(t.feedback)}</div></section>` : ''}
    <section><h3>Qué hizo cada agente</h3>
      ${steps.length ? `<ul class="steps">${steps.map((s) => `
        <li class="step"><div class="st ${s.status}">${stepIcon(s.status)}</div><div>
          <div><span class="who">${esc(s.role)}</span> <span class="what">${esc(STAGE_LABEL[s.stage] || s.stage)}${s.status === 'running' ? '…' : ''}</span></div>
          ${s.summary ? `<div class="summary">${esc(s.summary)}</div>` : ''}
        </div></li>`).join('')}</ul>` : `<div class="hint">${t.status === 'queued' ? 'Todavía no empezó. Va a arrancar cuando la flota esté en marcha y haya lugar.' : 'Sin pasos registrados.'}</div>`}
    </section>
    <section><h3>${running ? '<span class="badge b-run"><span class="pulse"></span>En vivo</span>' : ''} Actividad</h3><div class="activity" id="activity"></div></section>
    ${t.evidence?.length ? `<section><h3>Evidencia del QA</h3><div class="evidence">${t.evidence.map((f) => {
    const url = `/api/tasks/${t.id}/evidence/${encodeURIComponent(f)}`;
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(f)
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(f)}"><span>${esc(f)}</span></a>`
      : `<a href="${url}" target="_blank" rel="noopener"><span>${icon('file')} ${esc(f)}</span></a>`;
  }).join('')}</div></section>` : ''}
    <section id="diff-section" ${S.diff === null ? 'hidden' : ''}><h3>Cambios en el código</h3><div class="diff" id="diff"></div></section>
    ${t.plan ? `<section><details><summary>Plan del Tech Lead</summary><div class="md">${md(t.plan)}</div></details></section>` : ''}
    <section><details><summary>Historial</summary><ul class="history">${(t.history || []).slice().reverse().map((h) => `<li>${fmtTime(h.at)} · ${esc(h.msg)}</li>`).join('')}</ul></details></section>`;
  renderActivity();
  if (S.diff !== null) renderDiff();
}

function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderActivity() {
  const box = $('#activity');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const items = S.activity.slice(-150);
  box.innerHTML = items.length
    ? items.map((a) => `<div><span class="t">${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span><span class="k-${a.kind}">${a.role ? `${esc(a.role)} · ` : ''}${esc(a.text)}</span></div>`).join('')
    : '<span class="empty" style="padding:4px 10px">Sin actividad todavía.</span>';
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function renderDiff() {
  const box = $('#diff');
  if (!box) return;
  $('#diff-section').hidden = false;
  if (!S.diff) { box.innerHTML = '<div style="padding:10px;color:var(--faint)">No hay cambios para mostrar.</div>'; return; }
  box.innerHTML = S.diff.split('\n').map((l) => {
    if (l.startsWith('diff --git')) return `<div class="file">${esc(l.replace(/^diff --git a\/(.+?) b\/.*/, '$1'))}</div>`;
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)) return '';
    if (l.startsWith('@@')) return `<div class="hunk">${esc(l)}</div>`;
    if (l.startsWith('+')) return `<div class="add">${esc(l)}</div>`;
    if (l.startsWith('-')) return `<div class="del">${esc(l)}</div>`;
    return `<div>${esc(l)}</div>`;
  }).join('');
}

// ---------- markdown mínimo (informe y plan) ----------
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\s)_([^_]+)_/g, '$1<i>$2</i>');
}
function md(text) {
  const lines = String(text || '').split(/\r?\n/);
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      out += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
      i++;
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      out += `<table>${rows.filter((r) => !/^\|[\s|:-]+\|$/.test(r)).map((r, n) => `<tr>${r.split('|').slice(1, -1).map((c) => (n === 0 ? `<th>${inline(c.trim())}</th>` : `<td>${inline(c.trim())}</td>`)).join('')}</tr>`).join('')}</table>`;
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      out += `<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`;
      continue;
    }
    if (l.startsWith('>')) { out += `<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`; i++; continue; }
    if (l.trim()) out += `<p>${inline(l)}</p>`;
    i++;
  }
  return out;
}

// ---------- diálogos ----------
const dialog = $('#dialog');
function openDialog(html, onSubmit) {
  dialog.onclick = null;
  dialog.innerHTML = html;
  dialog.showModal();
  const form = dialog.querySelector('form');
  if (form && onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.err');
      if (errEl) errEl.textContent = '';
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const done = await onSubmit(new FormData(form), form);
        if (done !== false) dialog.close();
      } catch (err) {
        if (errEl) errEl.textContent = err.message; else toast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  const first = dialog.querySelector('input, textarea, select');
  if (first) first.focus();
}

function newTaskDialog() {
  openDialog(`<form>
    <h2>Nueva tarea</h2>
    <p class="intro">Cuanto más chica y concreta, mejor. Decí qué tiene que pasar y cómo se nota que funciona.</p>
    <label for="f-title">Título</label>
    <input id="f-title" name="title" placeholder="Corregir el total del carrito cuando hay descuento" autocomplete="off">
    <div class="err" id="title-err"></div>
    <label for="f-desc">Detalle (opcional)</label>
    <textarea id="f-desc" name="description" placeholder="Con una remera de $100 y 10% de descuento el total da $81 y debería dar $90."></textarea>
    <div class="grid2">
      <div><label for="f-area">Área (opcional)</label><input id="f-area" name="area" placeholder="carrito">
        <div class="hint">Dos tareas de la misma área no corren a la vez.</div></div>
      <div><label for="f-prio">Prioridad</label><select id="f-prio" name="priority"><option value="1">Alta</option><option value="2" selected>Normal</option><option value="3">Baja</option></select></div>
    </div>
    <div class="err"></div>
    <div class="buttons"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">${icon('plus')} Agregar a la cola</button></div>
  </form>`, async (fd, form) => {
    const title = String(fd.get('title') || '').trim();
    if (!title) {
      form.querySelector('#title-err').textContent = 'Escribí un título para la tarea.';
      form.querySelector('#f-title').addEventListener('input', () => { form.querySelector('#title-err').textContent = ''; }, { once: true });
      return false;
    }
    await api('POST', '/api/tasks', Object.fromEntries(fd));
    toast('Tarea agregada a la cola');
    return true;
  });
}

function requestChangesDialog() {
  const t = S.task;
  openDialog(`<form>
    <h2>${t.status === 'needs_human' ? 'Reintentar con indicaciones' : 'Pedir cambios'}</h2>
    <p class="intro">El Developer va a retomar <b>${esc(t.title)}</b> con tus indicaciones, y después pasa de nuevo por tests, QA y revisión.</p>
    <label for="f-fb">¿Qué hay que cambiar?</label>
    <textarea id="f-fb" name="feedback" placeholder="Usá la función applyDiscount existente en vez de duplicar el cálculo."></textarea>
    <div class="err"></div>
    <div class="buttons"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">${icon('refresh')} Enviar al Developer</button></div>
  </form>`, async (fd) => {
    const feedback = String(fd.get('feedback') || '').trim();
    if (!feedback) throw new Error('Escribí qué hay que cambiar.');
    await api('POST', `/api/tasks/${t.id}/request-changes`, { feedback });
    toast('Cambios enviados: la tarea vuelve a la cola');
  });
}

function settingsDialog() {
  const c = S.state.config;
  const models = ['opus', 'sonnet', 'haiku'];
  const sel = (name, value) => `<select name="${name}">${models.map((m) => `<option ${m === value ? 'selected' : ''}>${m}</option>`).join('')}${models.includes(value) ? '' : `<option selected>${esc(value)}</option>`}</select>`;
  openDialog(`<form>
    <h2>Configuración del proyecto</h2>
    <label>Modo</label>
    <div class="toggle" id="mode-toggle">
      <button type="button" data-mode="supervised" class="${c.mode !== 'auto' ? 'on' : ''}">Supervisado</button>
      <button type="button" data-mode="auto" class="${c.mode === 'auto' ? 'on' : ''}">Automático</button>
    </div>
    <div class="hint">Supervisado: vos aprobás cada tarea. Automático: se integran solas si pasan todo (para cuando ya confiás en el sistema).</div>
    <input type="hidden" name="mode" value="${c.mode}">
    <div class="grid2">
      <div><label>Agentes en paralelo</label><input type="number" name="maxConcurrent" min="1" max="20" step="1" value="${c.maxConcurrent}"></div>
      <div><label>Intentos por tarea</label><input type="number" name="maxAttempts" min="1" max="5" step="1" value="${c.maxAttempts}"></div>
    </div>
    <label>Comando de verificación (tiene que pasar siempre)</label>
    <input name="checkCommand" value="${esc(c.checkCommand)}" placeholder="npm test">
    <label>Tope diario de ejecuciones de agentes</label>
    <input type="number" name="maxAgentRunsPerDay" min="1" step="1" value="${c.maxAgentRunsPerDay}">
    <div class="hint">Cuida la cuota de tu plan de Claude. Fleet nunca usa API key${c.planOnly ? '' : ' (desactivado en este proyecto)'}.</div>
    <label>Modelos</label>
    <div class="grid2">
      <div><span class="hint">Tech Lead</span>${sel('m_plan', c.models.plan)}</div>
      <div><span class="hint">Developer</span>${sel('m_execute', c.models.execute)}</div>
      <div><span class="hint">QA Verifier</span>${sel('m_verify', c.models.verify)}</div>
      <div><span class="hint">Code Reviewer</span>${sel('m_review', c.models.review)}</div>
    </div>
    <label>Identidad de los commits de los agentes</label>
    <div class="grid2">
      <input name="gitName" value="${esc(c.gitAuthor?.name)}" placeholder="Nombre">
      <input name="gitEmail" value="${esc(c.gitAuthor?.email)}" placeholder="email">
    </div>
    <div class="hint">${c.gitAuthor?.name ? 'Los agentes firman con esta identidad, no con la global de la PC.' : 'Vacío: se usa la identidad de git de la PC. Recomendado completarla.'}</div>
    <div class="err"></div>
    <div class="buttons"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">Guardar</button></div>
  </form>`, async (fd) => {
    const gitName = String(fd.get('gitName') || '').trim();
    const gitEmail = String(fd.get('gitEmail') || '').trim();
    if (Boolean(gitName) !== Boolean(gitEmail)) throw new Error('Completá nombre y email de la identidad, o dejá ambos vacíos.');
    await api('POST', '/api/config', {
      mode: fd.get('mode'),
      maxConcurrent: Number(fd.get('maxConcurrent')),
      maxAttempts: Number(fd.get('maxAttempts')),
      checkCommand: String(fd.get('checkCommand') || '').trim(),
      maxAgentRunsPerDay: Number(fd.get('maxAgentRunsPerDay')),
      models: { plan: fd.get('m_plan'), execute: fd.get('m_execute'), verify: fd.get('m_verify'), review: fd.get('m_review') },
      gitAuthor: { name: gitName, email: gitEmail },
    });
    toast('Configuración guardada');
  });
  dialog.querySelectorAll('#mode-toggle button').forEach((b) => b.addEventListener('click', () => {
    dialog.querySelectorAll('#mode-toggle button').forEach((x) => x.classList.toggle('on', x === b));
    dialog.querySelector('input[name=mode]').value = b.dataset.mode;
  }));
}

async function projectsDialog(startPath) {
  const recent = S.state?.recent || [];
  let current = startPath ?? (S.state?.project ? S.state.project.repo.replace(/[\\/][^\\/]+$/, '') : '');
  openDialog(`<div class="body">
    <h2>Proyectos</h2>
    ${recent.length ? `<label>Recientes</label><div class="fsbox">${recent.map((r) => `<div class="fsrow" data-open="${esc(r.path)}">${icon('folder')}<span class="name">${esc(r.name)} <span class="hint">${esc(r.path)}</span></span></div>`).join('')}</div>` : ''}
    <label>Buscar una carpeta</label>
    <div class="pathbar"><button type="button" id="fs-up" title="Subir">${icon('up')}</button><input id="fs-path" placeholder="D:\\Proyectos"><button type="button" id="fs-go">Ir</button></div>
    <div class="fsbox" id="fs-list"></div>
    <div class="err" id="fs-err"></div>
    <div class="buttons">
      <button type="button" data-close>Cerrar</button>
      <button type="button" id="fs-demo">${icon('spark')} Crear tienda demo</button>
      <button type="button" class="primary" id="fs-open">${icon('folder')} Abrir esta carpeta</button>
    </div>
  </div>`);
  const load = async (p) => {
    try {
      const r = await api('GET', `/api/fs?path=${encodeURIComponent(p || '')}`);
      current = r.path;
      $('#fs-path').value = r.path;
      $('#fs-up').dataset.parent = r.parent ?? '';
      $('#fs-list').innerHTML = r.dirs.length ? r.dirs.map((d) => `<div class="fsrow" data-dir="${esc(d.path)}">${icon(d.isGit ? 'git' : 'folder')}<span class="name">${esc(d.name)}</span>${d.isFleet ? '<span class="badge b-ok">Fleet</span>' : d.isGit ? '<span class="badge b-neutral">git</span>' : ''}</div>`).join('') : '<div class="fsrow" style="cursor:default;color:var(--faint)">Sin subcarpetas</div>';
      $('#fs-err').textContent = '';
    } catch (e) { $('#fs-err').textContent = e.message; }
  };
  dialog.onclick = (e) => {
    const row = e.target.closest('[data-dir]');
    if (row) return load(row.dataset.dir);
    const rec = e.target.closest('[data-open]');
    if (rec) return openProject(rec.dataset.open);
    return undefined;
  };
  $('#fs-up').addEventListener('click', () => load($('#fs-up').dataset.parent));
  $('#fs-go').addEventListener('click', () => load($('#fs-path').value));
  $('#fs-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load($('#fs-path').value); } });
  $('#fs-open').addEventListener('click', () => openProject(current));
  $('#fs-demo').addEventListener('click', () => createDemo());
  load(current);
}

async function openProject(p) {
  try {
    const r = await api('POST', '/api/projects/open', { path: p });
    if (r.needsInit) return initDialog(r);
    dialog.close();
    closeTask();
    toast('Proyecto abierto');
  } catch (e) {
    const err = $('#fs-err');
    if (err && dialog.open) err.textContent = e.message; else toast(e.message, 'error');
  }
}

function initDialog({ repo, suggestion }) {
  openDialog(`<form>
    <h2>Preparar el proyecto</h2>
    <p class="intro">Es la primera vez que abrís <b>${esc(repo)}</b> con Fleet. Se crea la carpeta <code>.fleet/</code> (ignorada por git) y se agregan skills en <code>.claude/</code> sin pisar nada.</p>
    <label>Comando de verificación</label>
    <input name="checkCommand" value="${esc(suggestion.checkCommand)}" placeholder="npm test">
    <div class="hint">Lo más importante: los agentes no pueden integrar nada si esto falla. Idealmente lint + tests.</div>
    <label>Identidad de los commits de los agentes</label>
    <div class="grid2">
      <input name="gitName" value="${esc(suggestion.gitAuthor?.name)}" placeholder="Nombre">
      <input name="gitEmail" value="${esc(suggestion.gitAuthor?.email)}" placeholder="email">
    </div>
    <div class="hint">Recomendado: así los commits no salen con la identidad global de la PC.</div>
    <div class="err"></div>
    <div class="buttons"><button type="button" data-close>Cancelar</button><button type="submit" class="primary">Preparar y abrir</button></div>
  </form>`, async (fd) => {
    const gitName = String(fd.get('gitName') || '').trim();
    const gitEmail = String(fd.get('gitEmail') || '').trim();
    if (Boolean(gitName) !== Boolean(gitEmail)) throw new Error('Completá nombre y email, o dejá ambos vacíos.');
    await api('POST', '/api/projects/init', { path: repo, checkCommand: String(fd.get('checkCommand') || '').trim(), gitName, gitEmail });
    toast('Proyecto preparado. Completá .claude/skills/fleet-verify con cómo se prueba tu app.');
  });
}

async function createDemo() {
  toast('Creando la tienda demo…');
  const r = await act(() => api('POST', '/api/projects/demo', {}));
  if (r) {
    if (dialog.open) dialog.close();
    toast('Demo lista: 4 tareas en cola. Tocá Iniciar.');
  }
}

async function reportDialog() {
  const r = await act(() => api('GET', '/api/report'));
  if (!r) return;
  openDialog(`<div class="body">
    <h2>Informe</h2>
    <div class="md">${md(r.markdown.replace(/^# .*\n/, ''))}</div>
    <div class="buttons">
      <button type="button" id="run-audit" title="Usa tu plan de Claude">${icon('spark')} Auditar calidad (últimos 7 días)</button>
      <button type="button" class="primary" data-close>Cerrar</button>
    </div>
    <div id="audit-out" class="md"></div>
  </div>`);
  $('#run-audit').addEventListener('click', async (e) => {
    e.target.disabled = true;
    $('#audit-out').innerHTML = '<p class="hint">El Auditor de calidad está revisando los commits recientes. Puede tardar unos minutos…</p>';
    const a = await act(() => api('POST', '/api/audit'));
    $('#audit-out').innerHTML = a ? `<h3>Auditoría de calidad</h3>${md(a.text)}` : '';
    e.target.disabled = false;
  });
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-task]');
  if (card) return openTask(card.dataset.task);
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const t = S.task;
  switch (a) {
    case 'new-task': return newTaskDialog();
    case 'start': return act(() => api('POST', '/api/run/start'), 'Flota en marcha');
    case 'pause': return act(() => api('POST', '/api/run/pause'), 'Pausando: los agentes terminan el paso actual');
    case 'settings': return settingsDialog();
    case 'projects': return projectsDialog();
    case 'report': return reportDialog();
    case 'demo': return createDemo();
    case 'open-recent': return openProject(el.dataset.path);
    case 'close': return closeTask();
    case 'approve': {
      el.disabled = true;
      const r = await act(() => api('POST', `/api/tasks/${t.id}/approve`));
      if (r?.result === 'merged') toast('Integrada en tu proyecto');
      else if (r?.result === 'requeued') toast('Chocaba con otro cambio: vuelve a la cola para rehacerse', 'error');
      else if (r) toast(`Resultado: ${r.result}`, 'error');
      return refreshTask();
    }
    case 'request-changes': return requestChangesDialog();
    case 'retry': return act(() => api('POST', `/api/tasks/${t.id}/retry`), 'Tarea reencolada');
    case 'cancel':
      if (!window.confirm(`¿Cancelar "${t.title}"? Se descarta su trabajo.`)) return;
      await act(() => api('POST', `/api/tasks/${t.id}/cancel`), 'Tarea cancelada');
      return closeTask();
    case 'diff': {
      const r = await act(() => api('GET', `/api/tasks/${t.id}/diff`));
      if (r) { S.diff = r.diff; renderDiff(); $('#diff-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    default:
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.selected && !dialog.open) closeTask();
  if (e.key === 'Enter' && e.target.matches?.('.card')) openTask(e.target.dataset.task);
});
$('#scrim').addEventListener('click', closeTask);

connect();
