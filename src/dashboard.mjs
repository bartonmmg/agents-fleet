import http from 'node:http';

const PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fleet</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#e4e4df;--ok:#1f8a4c;--warn:#b26b00;--bad:#c0392b;--run:#2b6cb0}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececea;--mut:#9a9a94;--card:#1e1e1c;--line:#2e2e2b}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);margin-bottom:16px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.col{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;min-height:80px}
.col h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:0 0 8px}
.task{border-top:1px solid var(--line);padding:8px 0}.task:first-of-type{border-top:0}
.t{font-weight:600}.m{color:var(--mut);font-size:12px}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:99px;border:1px solid currentColor}
.running{color:var(--run)}.ready_to_merge{color:var(--warn)}.merged{color:var(--ok)}.needs_human{color:var(--bad)}
details{margin-top:4px}pre{white-space:pre-wrap;font-size:11px;max-height:200px;overflow:auto;background:var(--bg);padding:6px;border-radius:6px}
</style></head><body><main>
<h1>Fleet</h1><div class="sub" id="sub">cargando…</div>
<div class="cols" id="cols"></div>
</main><script>
const COLS=[['queued','En cola'],['running','Trabajando'],['ready_to_merge','Lista para merge'],['needs_human','Necesita humano'],['merged','Mergeada']];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){
  const r=await fetch('/api/state');const s=await r.json();
  document.getElementById('sub').textContent=\`modo \${s.mode} · ejecuciones hoy \${s.runsToday} / \${s.runLimit} (plan) · \${s.tasks.length} tareas · \${s.stopped?'⏸ DETENIDA':'activa'}\`;
  document.getElementById('cols').innerHTML=COLS.map(([k,l])=>{
    const ts=s.tasks.filter(t=>t.status===k||(k==='running'&&t.status==='merging')).sort((a,b)=>b.id-a.id).slice(0,40);
    return \`<section class="col"><h2>\${l} (\${ts.length})</h2>\${ts.map(t=>\`<div class="task">
      <div class="t">#\${t.id} \${esc(t.title)}</div>
      <div class="m">\${t.area?esc(t.area)+' · ':''}P\${t.priority} · intento \${t.attempts} \${t.stage?'<span class="badge '+t.status+'">'+esc(t.stage)+'</span>':''}</div>
      \${t.error?'<div class="m" style="color:var(--bad)">'+esc(String(t.error).slice(0,200))+'</div>':''}
      <details><summary class="m">detalle</summary><pre>\${esc(JSON.stringify({branch:t.branch,verdicts:t.verdicts,history:t.history.slice(-8)},null,2))}</pre></details>
    </div>\`).join('')}</section>\`}).join('');
}
load();setInterval(load,4000);
</script></body></html>`;

export function startDashboard({ cfg, store, isStopped }, port = 4400) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        mode: cfg.mode, runLimit: cfg.maxAgentRunsPerDay, runsToday: store.runsToday(),
        stopped: isStopped(), tasks: store.all(),
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
