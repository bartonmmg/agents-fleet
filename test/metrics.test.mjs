import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, firstTry } from '../src/studio/metrics.mjs';

const now = new Date(2026, 10, 24, 10, 0); // 24/11/2026 10:00 local
const at = (daysAgo, h = 9) => new Date(2026, 10, 24 - daysAgo, h, 0).toISOString();
const t = (over) => ({ status: 'merged', attempts: 1, history: [], mergedBy: 'usuario', ...over });

test('computeMetrics cuenta integraciones por día local, solas vs. a mano y primer intento', () => {
  const tasks = [
    t({ mergedAt: at(0), mergedBy: 'autopilot' }),
    t({ mergedAt: at(0, 2), attempts: 2 }),
    t({ mergedAt: at(3), history: [{ msg: 'cambios pedidos por el usuario' }] }),
    t({ mergedAt: at(6) }),
    t({ mergedAt: at(7) }), // fuera de la ventana de 7 días
    t({ status: 'ready_to_merge', mergedAt: null }),
  ];
  const m = computeMetrics(tasks, { runsToday: 12, maxRunsPerDay: 150, now });
  assert.equal(m.mergedToday, 2);
  assert.equal(m.merged7d, 4);
  assert.equal(m.autoMerged7d, 1);
  assert.equal(m.manualMerged7d, 3);
  assert.equal(m.firstTryRate, 50);
  assert.deepEqual(m.perDay.map((d) => d.merged), [1, 0, 0, 1, 0, 0, 2]);
  assert.equal(m.perDay.at(-1).date, '2026-11-24');
  assert.equal(m.runsToday, 12);
  assert.equal(m.maxRunsPerDay, 150);
});

test('computeMetrics sin integraciones no inventa una tasa', () => {
  const m = computeMetrics([], { now });
  assert.equal(m.merged7d, 0);
  assert.equal(m.firstTryRate, null);
  assert.equal(m.perDay.length, 7);
});

test('firstTry descarta reintentos y pedidos de cambios', () => {
  assert.equal(firstTry(t({})), true);
  assert.equal(firstTry(t({ attempts: 2 })), false);
  assert.equal(firstTry(t({ history: [{ msg: 'reintentada por el usuario' }] })), false);
});
