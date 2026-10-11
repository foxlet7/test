import type { Config } from './config';
import type { Db } from './db';
import type { AssessmentProvider } from './services/assessment';
import type { BlobStore } from './services/evidenceStore';
import { z } from 'zod';
import { badRequest } from './errors';

export interface Ctx {
  cfg: Config;
  db: Db;
  store: BlobStore;
  provider: AssessmentProvider;
  now: () => Date;
}

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('validation_failed', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const pseudonymSchema = z.string().min(3).max(24).regex(/^[\p{L}\p{N}_.\- ]+$/u, 'letters, numbers, _ . - and spaces only').refine((s) => !s.includes('@'), 'no @');
