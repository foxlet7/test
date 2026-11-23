import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availability, economics } from './billing.ts';

const H = 3600e3;
const start = Date.UTC(2026, 9, 1);
const end = start + 30 * 24 * H; // 30 days

function checks(fromMs: number, toMs: number, everySec: number, down?: [number, number]) {
  const out = [];
  for (let ts = fromMs; ts < toMs; ts += everySec * 1000) out.push({ ts, ok: !(down && ts >= down[0] && ts < down[1]) });
  return out;
}

test('availability: 1 h down in 30 days of 60 s checks', () => {
  const a = availability(checks(start, end, 60, [start + 10 * H, start + 11 * H]), start, end, 60);
  assert.equal(Math.round(a.downSecs), 3600);
  assert.ok(Math.abs(a.availabilityPct! - (100 - 100 / 720)) < 1e-6);
  assert.ok(a.coveragePct > 99.99);
});

test('availability: probe silent for a day counts as not monitored, not down', () => {
  const s = [...checks(start, start + 10 * 24 * H, 60), ...checks(start + 11 * 24 * H, end, 60)];
  const a = availability(s, start, end, 60);
  assert.equal(a.downSecs, 0);
  assert.equal(a.availabilityPct, 100);
  assert.ok(Math.abs(a.coveragePct - 100 * 29 / 30) < 0.01);
});

test('economics: SLA breach credit, downtime cost, cost per Mbps', () => {
  const a = availability(checks(start, end, 60, [start, start + 10 * H]), start, end, 60); // 10 h down = 98.61 %
  const e = economics({ monthlyCost: 12000, bandwidthMbps: 120, slaPct: 99.5, creditPctPerBreach: 10 }, a);
  assert.equal(e.costPerMbps, 100);
  assert.equal(e.slaMet, false);
  assert.equal(Math.round(e.creditDue), 1200);
  assert.equal(Math.round(e.downtimeCost), Math.round(12000 * 10 / 720));
});

test('economics: utilisation and real price per used Mbit/s', () => {
  const a = availability(checks(start, end, 60), start, end, 60);
  const traffic = Array.from({ length: 100 }, (_, i) => ({ ts: start + i * 60e3, inMbps: i < 95 ? 30 : 110, outMbps: 5 }));
  const e = economics({ monthlyCost: 12000, bandwidthMbps: 120 }, a, traffic);
  assert.equal(Math.round(e.p95UtilPct!), Math.round(100 * 110 / 120));
  assert.equal(Math.round(e.costPerUsedMbps!), Math.round(12000 / 110));
  assert.equal(e.slaMet, null);
});

test('economics: no SLA verdict or credit claim without 90% monitoring coverage', () => {
  // only the first 2 days monitored, 1 h down: availability looks bad, but evidence is thin
  const a = availability(checks(start, start + 48 * H, 60, [start, start + H]), start, end, 60);
  assert.ok(a.coveragePct < 10);
  const e = economics({ monthlyCost: 2200, slaPct: 99.5, creditPctPerBreach: 10 }, a);
  assert.equal(e.slaMet, null);
  assert.equal(e.creditDue, 0);
});
