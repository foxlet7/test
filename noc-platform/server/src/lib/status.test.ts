import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, worst } from './status.ts';

const t = { failAfter: 2, warnAbove: 100, downAbove: 300 };

test('one failed check does not flip an UP sensor to DOWN', () => {
  const n = evaluate(t, { status: 'UP', failCount: 0 }, { ok: false, message: 'timeout' });
  assert.equal(n.status, 'UP');
  assert.equal(n.failCount, 1);
  assert.match(n.message!, /1\/2/);
});
test('second consecutive failure confirms DOWN', () => {
  const n = evaluate(t, { status: 'UP', failCount: 1 }, { ok: false, message: 'timeout' });
  assert.equal(n.status, 'DOWN');
});
test('thresholds: warning and down above', () => {
  assert.equal(evaluate(t, { status: 'UP', failCount: 0 }, { ok: true, value: 150 }).status, 'WARNING');
  assert.equal(evaluate(t, { status: 'UP', failCount: 0 }, { ok: true, value: 301 }).status, 'DOWN');
  assert.equal(evaluate(t, { status: 'DOWN', failCount: 3 }, { ok: true, value: 20 }).status, 'UP');
});
test('below thresholds (e.g. bandwidth too low)', () => {
  const n = evaluate({ failAfter: 1, warnBelow: 10 }, { status: 'UP', failCount: 0 }, { ok: true, value: 4 });
  assert.equal(n.status, 'WARNING');
});
test('worst status wins', () => {
  assert.equal(worst(['UP', 'WARNING', 'DOWN', 'PAUSED']), 'DOWN');
  assert.equal(worst([]), 'PAUSED');
});

test('probe warn flag gives WARNING, but down thresholds still win', () => {
  assert.equal(evaluate(t, { status: 'UP', failCount: 0 }, { ok: true, value: 20, warn: true, message: 'cert expires in 5 days' }).status, 'WARNING');
  assert.equal(evaluate(t, { status: 'UP', failCount: 0 }, { ok: true, value: 400, warn: true }).status, 'DOWN');
});
