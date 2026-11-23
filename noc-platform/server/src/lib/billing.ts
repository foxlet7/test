// Circuit economics: what a link cost, how available it was, and what the carrier owes.
// Pure functions over plain data so the same numbers appear on screen, in reports and in tests.

export interface Sample { ts: number; ok: boolean } // ts in ms
export interface TrafficSample { ts: number; inMbps: number; outMbps: number }

export interface Availability {
  periodSecs: number;
  monitoredSecs: number;
  downSecs: number;
  availabilityPct: number | null; // over monitored time; null when nothing was measured
  coveragePct: number;
}

// Each check stands for the time until the next one, capped at 2 intervals so a probe that
// went silent is counted as "not monitored", not as up or down.
export function availability(samples: Sample[], startMs: number, endMs: number, intervalSec: number): Availability {
  const s = samples.filter((x) => x.ts >= startMs && x.ts < endMs).sort((a, b) => a.ts - b.ts);
  const cap = intervalSec * 2 * 1000;
  let monitored = 0;
  let down = 0;
  for (let i = 0; i < s.length; i++) {
    const next = i + 1 < s.length ? s[i + 1].ts : Math.min(endMs, s[i].ts + intervalSec * 1000);
    const span = Math.max(0, Math.min(next - s[i].ts, cap, endMs - s[i].ts));
    monitored += span;
    if (!s[i].ok) down += span;
  }
  const periodSecs = (endMs - startMs) / 1000;
  return {
    periodSecs,
    monitoredSecs: monitored / 1000,
    downSecs: down / 1000,
    availabilityPct: monitored > 0 ? 100 * (1 - down / monitored) : null,
    coveragePct: periodSecs > 0 ? (100 * monitored) / 1000 / periodSecs : 0,
  };
}

export interface CircuitTerms {
  monthlyCost: number;
  bandwidthMbps?: number | null;
  slaPct?: number | null;
  creditPctPerBreach?: number | null;
}

export interface Economics {
  periodCost: number;           // monthly fee pro-rated to the period
  costPerMbps: number | null;
  downtimeCost: number;         // share of the fee paid for time the link was down
  slaMet: boolean | null;       // null = no SLA or nothing measured
  creditDue: number;            // what to claim from the carrier
  avgUtilPct: number | null;    // average of max(in, out) vs bandwidth
  p95UtilPct: number | null;
  costPerUsedMbps: number | null; // fee divided by 95th-percentile used Mbit/s: the "real" price
}

const DAY = 86400;
export const MIN_COVERAGE_PCT = 90; // monitoring coverage needed before an SLA verdict

export function economics(t: CircuitTerms, a: Availability, traffic: TrafficSample[] = []): Economics {
  const monthSecs = 30 * DAY;
  const periodCost = t.monthlyCost * Math.min(1, a.periodSecs / monthSecs);
  const costPerMbps = t.bandwidthMbps ? t.monthlyCost / t.bandwidthMbps : null;
  const downtimeCost = a.periodSecs > 0 ? periodCost * (a.downSecs / a.periodSecs) : 0;
  // No verdict (and no credit claim) without enough evidence: a carrier will reject a claim
  // built on a few hours of data, and so should we.
  const slaMet = t.slaPct == null || a.availabilityPct == null || a.coveragePct < MIN_COVERAGE_PCT ? null : a.availabilityPct >= t.slaPct;
  const creditDue = slaMet === false && t.creditPctPerBreach ? periodCost * (t.creditPctPerBreach / 100) : 0;

  let avgUtilPct: number | null = null;
  let p95UtilPct: number | null = null;
  let costPerUsedMbps: number | null = null;
  if (traffic.length && t.bandwidthMbps) {
    const peak = traffic.map((x) => Math.max(x.inMbps, x.outMbps)).sort((x, y) => x - y);
    const avg = peak.reduce((sum, x) => sum + x, 0) / peak.length;
    const p95 = peak[Math.min(peak.length - 1, Math.floor(peak.length * 0.95))];
    avgUtilPct = (100 * avg) / t.bandwidthMbps;
    p95UtilPct = (100 * p95) / t.bandwidthMbps;
    costPerUsedMbps = p95 > 0 ? t.monthlyCost / p95 : null;
  }
  return { periodCost, costPerMbps, downtimeCost, slaMet, creditDue, avgUtilPct, p95UtilPct, costPerUsedMbps };
}
