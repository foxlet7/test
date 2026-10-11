/**
 * Pluggable AI pre-check. Defaults to OFF (feature flag `ai_precheck`).
 * Contract: the provider MUST be able to abstain, and a low-confidence or "review" result never
 * rejects anyone — it only routes to human review. Providers must not train on or retain audio.
 */
export interface AssessmentInput {
  audio: Buffer;
  mime: string;
  taskId: string;
  passageRef: string | null;
  referenceEdition: string | null;
}

export interface AssessmentResult {
  result: 'match' | 'review' | 'unable_to_assess';
  confidence: number;
  notes?: string;
}

export interface AssessmentProvider {
  readonly name: string;
  assess(input: AssessmentInput): Promise<AssessmentResult>;
}

/** Always abstains. */
export class NullProvider implements AssessmentProvider {
  readonly name = 'none';
  async assess(): Promise<AssessmentResult> {
    return { result: 'unable_to_assess', confidence: 0, notes: 'no provider configured' };
  }
}

/** Test/dev provider: behavior is selected by the first byte of the audio. */
export class MockProvider implements AssessmentProvider {
  readonly name = 'mock';
  async assess(input: AssessmentInput): Promise<AssessmentResult> {
    const b = input.audio[0];
    if (b === 0x01) return { result: 'match', confidence: 0.99 };
    if (b === 0x02) return { result: 'review', confidence: 0.4 };
    return { result: 'unable_to_assess', confidence: 0 };
  }
}
