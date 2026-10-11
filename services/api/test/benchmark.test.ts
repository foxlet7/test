import { describe, expect, it } from 'vitest';
import { evaluateGate, metrics, type BenchRecord } from '../src/benchmark';

const rec = (label: BenchRecord['label'], predicted: BenchRecord['predicted'], group = 'g1'): BenchRecord => ({ id: Math.random().toString(), label, predicted, group });

describe('benchmark gate', () => {
  it('computes false-accept, false-reject and abstention separately', () => {
    const m = metrics([rec('correct', 'match'), rec('correct', 'review'), rec('incorrect', 'match'), rec('incorrect', 'unable_to_assess')]);
    expect(m.falseAcceptRate).toBe(0.5);
    expect(m.falseRejectRate).toBe(0.5);
    expect(m.abstentionRate).toBe(0.25);
  });
  it('fails when any subgroup breaches a threshold even if overall looks fine', () => {
    const rows = [
      ...Array.from({ length: 200 }, () => rec('correct', 'match', 'accent_a')),
      ...Array.from({ length: 100 }, () => rec('incorrect', 'review', 'accent_a')),
      ...Array.from({ length: 30 }, () => rec('correct', 'review', 'accent_b')),
    ];
    const res = evaluateGate(rows, { maxFalseAccept: 0.01, maxFalseReject: 0.2, minPerGroup: 30 });
    expect(res.overall.falseRejectRate).toBeLessThan(0.2);
    expect(res.pass).toBe(false);
    expect(res.failures.join()).toMatch(/group:accent_b/);
  });
  it('blocks undersized samples and passes a clean large sample', () => {
    expect(evaluateGate([rec('correct', 'match')], { maxFalseAccept: 0.01, maxFalseReject: 0.2, minPerGroup: 30 }).pass).toBe(false);
    const ok = Array.from({ length: 40 }, () => rec('correct', 'match')).concat(Array.from({ length: 40 }, () => rec('incorrect', 'review')));
    expect(evaluateGate(ok, { maxFalseAccept: 0.01, maxFalseReject: 0.2, minPerGroup: 30 }).pass).toBe(true);
  });
});
