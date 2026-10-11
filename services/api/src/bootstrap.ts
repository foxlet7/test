import { DEFAULT_SCORING_RULE } from '@gdc/shared';
import type { Db } from './db';

export const PILOT_CHECKLIST: [string, string][] = [
  ['1_points_understood', 'Users understand points are game mechanics, not merit'],
  ['2_languages', 'Core tasks work in Arabic and English without material errors'],
  ['3_privacy', 'Consent, private-by-default, evidence deletion, account deletion, leaderboard opt-out pass end-to-end'],
  ['4_rankings', 'Rankings reproducible (duplicates, late verification, corrections)'],
  ['5_verification', 'Verification fair: labelled cases, abstention/escalation, appeals, reviewer agreement measured'],
  ['6_operations', 'Operations sustainable: workload, turnaround, support burden, cost within budget'],
  ['7_content', 'Religious content approved with reviewers, sources, translation review, correction process'],
];

/** Idempotent. Safe to run on every start. */
export async function bootstrap(db: Db): Promise<void> {
  await db.query(
    "insert into scoring_rule_versions(version, config, effective_from, note) values (1, $1, '2000-01-01', 'Initial rules') on conflict do nothing",
    [JSON.stringify(DEFAULT_SCORING_RULE)]);
  const flags: [string, string][] = [
    ['ai_precheck', 'Run the AI pre-check on recitations (advisory only). OFF until benchmark gates pass.'],
    ['ai_auto_verify', 'Allow the AI to auto-verify high-confidence, risk-free matches. OFF by default.'],
  ];
  for (const [k, d] of flags) await db.query('insert into feature_flags(key, enabled, description) values ($1,false,$2) on conflict do nothing', [k, d]);
  for (const [k, t] of PILOT_CHECKLIST) await db.query('insert into pilot_checklist(key, title) values ($1,$2) on conflict do nothing', [k, t]);
}
