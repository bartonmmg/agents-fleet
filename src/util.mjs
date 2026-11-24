import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const now = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Escribe a un archivo temporal y renombra, para no dejar JSON a medias si el proceso muere. */
export function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function tail(text, maxChars = 4000) {
  if (!text) return '';
  return text.length <= maxChars ? text : `…(recortado)…\n${text.slice(-maxChars)}`;
}

export function log(...args) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}]`, ...args);
}

/** Corre un comando de shell (para el checkCommand del proyecto). Nunca lanza: devuelve ok/salida. */
export function runShell(command, cwd, timeoutMs = 20 * 60_000) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.length > 2_000_000) out = out.slice(-1_000_000); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { out += '\n[fleet] timeout: comando cancelado'; killTree(child); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, output: `${out}\n${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, output: out }); });
  });
}

export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}

/** Extrae el último bloque JSON válido de la respuesta de un agente. */
export function extractJson(text) {
  if (!text) return null;
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of fenced.reverse()) {
    try { return JSON.parse(block.trim()); } catch { /* sigue */ }
  }
  // Busca el último objeto {...} balanceado que parsee.
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') depth++;
      else if (text[i] === '{') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(i, end + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
