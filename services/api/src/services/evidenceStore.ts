import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Config } from '../config';

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements BlobStore {
  data = new Map<string, Buffer>();
  async put(k: string, d: Buffer) { this.data.set(k, d); }
  async get(k: string) {
    const v = this.data.get(k);
    if (!v) throw new Error('missing blob');
    return v;
  }
  async delete(k: string) { this.data.delete(k); }
}

export class LocalFsStore implements BlobStore {
  constructor(private root: string) {}
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(resolve(this.root))) throw new Error('bad key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  get(key: string) { return readFile(this.path(key)); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

/** S3-compatible backend; the AWS SDK is loaded lazily so it is optional for local development. */
export class S3Store implements BlobStore {
  private client: any;
  private mods: any;
  constructor(private bucket: string, private region?: string, private endpoint?: string) {}
  private async c() {
    if (!this.client) {
      const mod = await import('@aws-sdk/client-s3');
      this.mods = mod;
      this.client = new mod.S3Client({ region: this.region, endpoint: this.endpoint, forcePathStyle: !!this.endpoint });
    }
    return this.client;
  }
  async put(key: string, data: Buffer) {
    const c = await this.c();
    await c.send(new this.mods.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string) {
    const c = await this.c();
    const r = await c.send(new this.mods.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async delete(key: string) {
    const c = await this.c();
    await c.send(new this.mods.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Client-side AES-256-GCM so evidence is encrypted before it reaches any backend. */
export class EncryptedStore implements BlobStore {
  constructor(private inner: BlobStore, private key: Buffer) {
    if (key.length !== 32) throw new Error('key must be 32 bytes');
  }
  async put(k: string, data: Buffer) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    await this.inner.put(k, Buffer.concat([iv, c.getAuthTag(), enc]));
  }
  async get(k: string) {
    const raw = await this.inner.get(k);
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }
  delete(k: string) { return this.inner.delete(k); }
}

export function makeStore(cfg: Config): BlobStore {
  const inner: BlobStore =
    cfg.evidenceBackend === 'memory' ? new MemoryStore()
    : cfg.evidenceBackend === 's3' ? new S3Store(cfg.s3Bucket!, cfg.s3Region, cfg.s3Endpoint)
    : new LocalFsStore(cfg.evidenceDir);
  return new EncryptedStore(inner, cfg.evidenceKey);
}
