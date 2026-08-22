import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat as fsStat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  readLocalStorageRoot,
  readStorageBackend,
  readStorageSigningSecret,
  type StorageBackend,
} from './config.js';

export interface ObjectSaveOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ObjectReadUrlOptions {
  expiresMs?: number;
  contentType?: string;
  responseDisposition?: string;
}

export interface ObjectMetadata {
  size: number;
  contentType?: string;
  metadata?: Record<string, string>;
  updatedAt?: string;
}

export interface ObjectReadStreamOptions {
  start?: number;
  end?: number;
}

export interface ObjectStore {
  readonly backend: StorageBackend;
  save(objectPath: string, data: Buffer, options?: ObjectSaveOptions): Promise<void>;
  delete(objectPath: string, options?: { ignoreNotFound?: boolean }): Promise<void>;
  exists(objectPath: string): Promise<boolean>;
  stat(objectPath: string): Promise<ObjectMetadata>;
  download(objectPath: string): Promise<Buffer>;
  createReadStream(objectPath: string, options?: ObjectReadStreamOptions): NodeJS.ReadableStream;
  createSignedReadUrl(objectPath: string, options?: ObjectReadUrlOptions): Promise<string>;
  createPersistentReadUrl(
    objectPath: string,
    options?: Omit<ObjectReadUrlOptions, 'expiresMs'>
  ): Promise<string>;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === '404' || code === 'ENOENT';
}

export function normalizeObjectPath(value: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\0') ||
        segment.includes(':')
    )
  ) {
    throw Object.assign(new Error('Invalid storage object path'), { statusCode: 400 });
  }
  return segments.join('/');
}

type LocalMetadataFile = ObjectMetadata & { objectPath: string };

function publicBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = String(env.PUBLIC_BASE_URL || env.APP_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
  return configured;
}

function signedPayload(input: {
  objectPath: string;
  expiresAt: number;
  contentType?: string;
  responseDisposition?: string;
}): string {
  return [
    input.objectPath,
    String(input.expiresAt),
    input.contentType || '',
    input.responseDisposition || '',
  ].join('\n');
}

function signLocalRead(input: {
  objectPath: string;
  expiresAt: number;
  contentType?: string;
  responseDisposition?: string;
}, env: NodeJS.ProcessEnv): string {
  return createHmac('sha256', readStorageSigningSecret(env))
    .update(signedPayload(input))
    .digest('base64url');
}

function buildLocalReadUrl(
  objectPath: string,
  options: ObjectReadUrlOptions,
  expiresAt: number,
  env: NodeJS.ProcessEnv
): string {
  const input = {
    objectPath: normalizeObjectPath(objectPath),
    expiresAt,
    contentType: options.contentType,
    responseDisposition: options.responseDisposition,
  };
  const params = new URLSearchParams({
    path: input.objectPath,
    expires: String(input.expiresAt),
    signature: signLocalRead(input, env),
  });
  if (input.contentType) params.set('type', input.contentType);
  if (input.responseDisposition) params.set('disposition', input.responseDisposition);
  return `${publicBaseUrl(env)}/api/v1/files/read?${params.toString()}`;
}

export interface VerifiedLocalReadUrl {
  objectPath: string;
  expiresAt: number;
  contentType?: string;
  responseDisposition?: string;
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function verifyLocalReadUrl(
  query: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
): VerifiedLocalReadUrl {
  const input = {
    objectPath: normalizeObjectPath(queryString(query.path)),
    expiresAt: Number(queryString(query.expires)),
    contentType: queryString(query.type) || undefined,
    responseDisposition: queryString(query.disposition) || undefined,
  };
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt < 0) {
    throw Object.assign(new Error('Invalid storage URL expiry'), { statusCode: 403 });
  }
  if (input.expiresAt !== 0 && input.expiresAt <= now) {
    throw Object.assign(new Error('Storage URL has expired'), { statusCode: 403 });
  }

  const provided = queryString(query.signature);
  const expected = signLocalRead(input, env);
  let providedBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(provided, 'base64url');
    expectedBuffer = Buffer.from(expected, 'base64url');
  } catch {
    throw Object.assign(new Error('Invalid storage URL signature'), { statusCode: 403 });
  }
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw Object.assign(new Error('Invalid storage URL signature'), { statusCode: 403 });
  }
  return input;
}

class LocalObjectStore implements ObjectStore {
  readonly backend = 'local' as const;
  private readonly root: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
    this.root = readLocalStorageRoot(env);
  }

  private resolve(objectPath: string): string {
    const normalized = normalizeObjectPath(objectPath);
    const resolved = path.resolve(this.root, ...normalized.split('/'));
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw Object.assign(new Error('Invalid storage object path'), { statusCode: 400 });
    }
    return resolved;
  }

  private metadataPath(objectPath: string): string {
    return `${this.resolve(objectPath)}.edutrack-meta.json`;
  }

  async save(objectPath: string, data: Buffer, options: ObjectSaveOptions = {}): Promise<void> {
    const normalized = normalizeObjectPath(objectPath);
    const target = this.resolve(normalized);
    const metadataTarget = this.metadataPath(normalized);
    const suffix = randomUUID();
    const tempTarget = `${target}.${suffix}.tmp`;
    const tempMetadata = `${metadataTarget}.${suffix}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    const metadata: LocalMetadataFile = {
      objectPath: normalized,
      size: data.byteLength,
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeFile(tempTarget, data, { flag: 'wx' });
      await writeFile(tempMetadata, JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx' });
      await rename(tempTarget, target);
      await rename(tempMetadata, metadataTarget);
    } catch (error) {
      await Promise.all([
        rm(tempTarget, { force: true }).catch(() => undefined),
        rm(tempMetadata, { force: true }).catch(() => undefined),
      ]);
      throw error;
    }
  }

  async delete(objectPath: string, options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    try {
      await rm(this.resolve(objectPath));
    } catch (error) {
      if (!(options.ignoreNotFound && isNotFound(error))) throw error;
    }
    await rm(this.metadataPath(objectPath), { force: true });
  }

  async exists(objectPath: string): Promise<boolean> {
    try {
      await fsStat(this.resolve(objectPath));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async stat(objectPath: string): Promise<ObjectMetadata> {
    const target = this.resolve(objectPath);
    const diskStat = await fsStat(target);
    try {
      const metadata = JSON.parse(
        await readFile(this.metadataPath(objectPath), 'utf8')
      ) as LocalMetadataFile;
      return {
        size: diskStat.size,
        ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
        ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
        ...(metadata.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
      };
    } catch (error) {
      if (!isNotFound(error) && !(error instanceof SyntaxError)) throw error;
      return { size: diskStat.size, updatedAt: diskStat.mtime.toISOString() };
    }
  }

  download(objectPath: string): Promise<Buffer> {
    return readFile(this.resolve(objectPath));
  }

  createReadStream(objectPath: string, options: ObjectReadStreamOptions = {}): ReadStream {
    return createReadStream(this.resolve(objectPath), options);
  }

  async createSignedReadUrl(
    objectPath: string,
    options: ObjectReadUrlOptions = {}
  ): Promise<string> {
    return buildLocalReadUrl(
      objectPath,
      options,
      Date.now() + (options.expiresMs || 10 * 60 * 1000),
      this.env
    );
  }

  async createPersistentReadUrl(
    objectPath: string,
    options: Omit<ObjectReadUrlOptions, 'expiresMs'> = {}
  ): Promise<string> {
    return buildLocalReadUrl(objectPath, options, 0, this.env);
  }
}

export function getObjectStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  readStorageBackend(env);
  return new LocalObjectStore(env);
}
