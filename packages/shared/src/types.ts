export const TRADITIONS = ['islam', 'christianity'] as const;
export type Tradition = (typeof TRADITIONS)[number];

export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const CATEGORIES = ['worship', 'learning', 'charity', 'character', 'service'] as const;
export type Category = (typeof CATEGORIES)[number];

export const OBLIGATION_CLASSES = ['obligatory', 'voluntary', 'general_good_deed'] as const;
export type ObligationClass = (typeof OBLIGATION_CLASSES)[number];

/** A = private self-log, B = assessable (scripture pilot), C = externally confirmable (Phase 2 hook). */
export const VERIFICATION_CLASSES = ['A', 'B', 'C'] as const;
export type VerificationClass = (typeof VERIFICATION_CLASSES)[number];

export const CONTENT_STATUSES = ['draft', 'in_review', 'approved', 'retired'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const LOG_STATUSES = [
  'self_reported',
  'pending_review',
  'verified',
  'unable_to_verify',
  'rejected',
  'under_investigation',
] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export const CONSENT_TYPES = ['account', 'evidence', 'ai_processing', 'leaderboard_A', 'leaderboard_B'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const BOARDS = ['A', 'B'] as const;
export type Board = (typeof BOARDS)[number];

export const PERIODS = ['weekly', 'monthly', 'lifetime'] as const;
export type Period = (typeof PERIODS)[number];

export const ROLES = [
  'super_admin',
  'content_admin',
  'islamic_reviewer',
  'christian_reviewer',
  'translation_reviewer',
  'verification_reviewer',
  'moderator',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

/** Repeat policies are data, defined per activity (never one global cap). */
export type RepeatPolicy =
  | { kind: 'per_day'; max: number }
  | { kind: 'per_week'; max: number }
  | { kind: 'per_milestone' }; // once per (user, activity, milestoneKey)

export interface ScoringRuleConfig {
  /** Days after the activity date within which verification still credits the original date. */
  lateVerificationWindowDays: number;
  /** How many days back a user may log an activity. */
  maxBackdateDays: number;
  /** Adjustments with |points| >= this need a second approver. */
  adjustmentApprovalThreshold: number;
}

export const DEFAULT_SCORING_RULE: ScoringRuleConfig = {
  lateVerificationWindowDays: 14,
  maxBackdateDays: 2,
  adjustmentApprovalThreshold: 20,
};

export interface ReligiousReference {
  label: string;
  source: string;
  /** Must be verified by qualified reviewers before the activity is approved. */
  verified: boolean;
}
