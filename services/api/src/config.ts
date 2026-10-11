import { randomBytes } from 'node:crypto';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string | null; // null => embedded PGlite (dev/test only)
  pgliteDir: string | null;
  jwtSecret: string;
  evidenceKey: Buffer; // 32 bytes, AES-256-GCM master key
  evidenceDir: string;
  evidenceBackend: 'local' | 's3' | 'memory';
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  corsOrigins: string[];
  rateLimit: boolean;
  appealWindowDays: number;
  evidenceMaxBytes: number;
  exposeResetTokens: boolean;
  assessmentProvider: 'none' | 'mock';
  aiAutoVerifyMinConfidence: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV as Config['env']) || 'development';
  const prod = env === 'production';
  const need = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} must be set in production`);
    return v;
  };
  const jwtSecret = process.env.JWT_SECRET ?? (prod ? need('JWT_SECRET') : randomBytes(32).toString('hex'));
  const keyHex = process.env.EVIDENCE_KEY_HEX ?? (prod ? need('EVIDENCE_KEY_HEX') : randomBytes(32).toString('hex'));
  if (keyHex.length !== 64) throw new Error('EVIDENCE_KEY_HEX must be 64 hex chars (32 bytes)');
  if (prod && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET too short');
  const cfg: Config = {
    env,
    port: Number(process.env.PORT ?? 8080),
    databaseUrl: process.env.DATABASE_URL ?? null,
    pgliteDir: process.env.PGLITE_DIR ?? null,
    jwtSecret,
    evidenceKey: Buffer.from(keyHex, 'hex'),
    evidenceDir: process.env.EVIDENCE_DIR ?? './var/evidence',
    evidenceBackend: (process.env.EVIDENCE_BACKEND as Config['evidenceBackend']) ?? 'local',
    s3Bucket: process.env.S3_BUCKET,
    s3Region: process.env.S3_REGION,
    s3Endpoint: process.env.S3_ENDPOINT,
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    rateLimit: process.env.RATE_LIMIT !== 'off',
    appealWindowDays: Number(process.env.APPEAL_WINDOW_DAYS ?? 14),
    evidenceMaxBytes: Number(process.env.EVIDENCE_MAX_BYTES ?? 10 * 1024 * 1024),
    exposeResetTokens: !prod,
    assessmentProvider: (process.env.ASSESSMENT_PROVIDER as Config['assessmentProvider']) ?? 'none',
    aiAutoVerifyMinConfidence: Number(process.env.AI_AUTO_VERIFY_MIN_CONFIDENCE ?? 0.98),
  };
  if (prod && !cfg.databaseUrl) throw new Error('DATABASE_URL must be set in production');
  return { ...cfg, ...overrides };
}
