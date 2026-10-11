/**
 * Benchmark metrics for the (flagged, off-by-default) AI pre-check.
 * Input: records labelled independently by qualified reviewers. Never report a single aggregate score:
 * false-accept / false-reject / abstention are reported overall AND per subgroup.
 */
export interface BenchRecord {
  id: string;
  label: 'correct' | 'incorrect'; // reviewer ground truth
  predicted: 'match' | 'review' | 'unable_to_assess';
  group?: string; // passage, accent, device, recitation style...
}

export interface Metrics {
  n: number;
  falseAcceptRate: number | null; // incorrect recitations the model called "match"
  falseRejectRate: number | null; // correct recitations the model did NOT call "match" (sent to review/abstained)
  abstentionRate: number | null;
  correctN: number;
  incorrectN: number;
}

const rate = (num: number, den: number) => (den === 0 ? null : num / den);

export function metrics(rows: BenchRecord[]): Metrics {
  const correct = rows.filter((r) => r.label === 'correct');
  const incorrect = rows.filter((r) => r.label === 'incorrect');
  return {
    n: rows.length,
    correctN: correct.length,
    incorrectN: incorrect.length,
    falseAcceptRate: rate(incorrect.filter((r) => r.predicted === 'match').length, incorrect.length),
    falseRejectRate: rate(correct.filter((r) => r.predicted !== 'match').length, correct.length),
    abstentionRate: rate(rows.filter((r) => r.predicted === 'unable_to_assess').length, rows.length),
  };
}

export interface Thresholds { maxFalseAccept: number; maxFalseReject: number; minPerGroup: number }

export interface GateResult { pass: boolean; overall: Metrics; groups: Record<string, Metrics>; failures: string[] }

/** Gate: all thresholds must hold overall and for every group; undersized groups block enabling the model. */
export function evaluateGate(rows: BenchRecord[], t: Thresholds): GateResult {
  const overall = metrics(rows);
  const groups: Record<string, Metrics> = {};
  for (const g of new Set(rows.map((r) => r.group ?? 'ungrouped'))) groups[g] = metrics(rows.filter((r) => (r.group ?? 'ungrouped') === g));
  const failures: string[] = [];
  const check = (name: string, m: Metrics) => {
    if (m.n < t.minPerGroup) failures.push(`${name}: sample too small (${m.n} < ${t.minPerGroup}); keep human review`);
    if (m.falseAcceptRate != null && m.falseAcceptRate > t.maxFalseAccept) failures.push(`${name}: false-accept ${m.falseAcceptRate.toFixed(3)} > ${t.maxFalseAccept}`);
    if (m.falseRejectRate != null && m.falseRejectRate > t.maxFalseReject) failures.push(`${name}: false-reject ${m.falseRejectRate.toFixed(3)} > ${t.maxFalseReject}`);
  };
  check('overall', overall);
  for (const [g, m] of Object.entries(groups)) check(`group:${g}`, m);
  return { pass: failures.length === 0, overall, groups, failures };
}
