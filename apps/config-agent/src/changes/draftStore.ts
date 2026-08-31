import {
  deleteSecureArtifact,
  ensureStorageDirectories,
  readArtifactIndex,
  readSecureArtifact,
  updateArtifactIndex,
  writeAtomicSecureArtifact,
  type ArtifactIndexEntry,
  type SecureStorageOptions
} from './artifactStorage.js';
import {
  decryptEnvelope,
  encryptEnvelope,
  type EnvelopeKey
} from '../crypto/encryptedEnvelope.js';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
export const STAGED_TTL_MS = 24 * 60 * 60 * 1_000;

type DateInput = Date | undefined;

export type DraftStoreOptions = SecureStorageOptions &
  Readonly<{
    stagingKey: EnvelopeKey;
    draftTtlMs?: number;
    stagedTtlMs?: number;
    randomBytes?: (size: number) => Uint8Array;
  }>;

export type DraftWriteInput<T> = Readonly<{
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  value: T;
  now?: Date;
}>;

export type SealDraftInput = Readonly<{
  changeId: string;
  now?: Date;
}>;

export class DraftStoreError extends Error {
  readonly code:
    | 'DRAFT_INVALID'
    | 'DRAFT_NOT_FOUND'
    | 'DRAFT_CORRUPT'
    | 'DRAFT_KEY_INVALID';

  constructor(code: DraftStoreError['code']) {
    super(code);
    this.name = 'DraftStoreError';
    this.code = code;
  }
}

function fail(code: DraftStoreError['code']): never {
  throw new DraftStoreError(code);
}

function asDate(value: DateInput): Date {
  const date = value ?? new Date();
  if (!Number.isFinite(date.getTime())) fail('DRAFT_INVALID');
  return date;
}

function ttl(value: number | undefined, defaultValue: number): number {
  const result = value ?? defaultValue;
  if (!Number.isSafeInteger(result) || result <= 0 || result > DRAFT_TTL_MS) {
    fail('DRAFT_INVALID');
  }
  return result;
}

function encodeValue(value: unknown): Buffer {
  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (
        typeof nestedValue === 'object' &&
        nestedValue !== null &&
        'type' in nestedValue &&
        nestedValue.type === 'Buffer' &&
        'data' in nestedValue &&
        Array.isArray(nestedValue.data)
      ) {
        return { __edutrackBuffer: Buffer.from(nestedValue.data).toString('base64') };
      }
      return nestedValue;
    });
    if (serialized === undefined) fail('DRAFT_INVALID');
    return Buffer.from(serialized, 'utf8');
  } catch (error) {
    if (error instanceof DraftStoreError) throw error;
    fail('DRAFT_INVALID');
  }
}

export function decodeStoredValue<T>(plaintext: Uint8Array): T {
  try {
    return JSON.parse(Buffer.from(plaintext).toString('utf8'), (_key, value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        '__edutrackBuffer' in value &&
        typeof value.__edutrackBuffer === 'string'
      ) {
        return Buffer.from(value.__edutrackBuffer, 'base64');
      }
      return value;
    }) as T;
  } catch {
    fail('DRAFT_CORRUPT');
  }
}

function entryFor(input: {
  id: string;
  kind: 'draft' | 'staged';
  appId: string;
  changeId: string;
  catalogVersion: string;
  manifestVersion: string;
  now: Date;
  expiresAt: Date;
}): ArtifactIndexEntry {
  return {
    id: input.id,
    kind: input.kind,
    changeId: input.changeId,
    appId: input.appId,
    catalogVersion: input.catalogVersion,
    manifestVersion: input.manifestVersion,
    createdAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    retention: 'normal'
  };
}

function isExpired(entry: ArtifactIndexEntry, now: Date): boolean {
  return Date.parse(entry.expiresAt) <= now.getTime();
}

export class DraftStore {
  private readonly storage: SecureStorageOptions;
  private readonly stagingKey: EnvelopeKey;
  private readonly draftTtl: number;
  private readonly stagedTtl: number;
  private readonly randomBytes: ((size: number) => Uint8Array) | undefined;

  constructor(options: DraftStoreOptions) {
    if (options.stagingKey.purpose !== 'staging') fail('DRAFT_KEY_INVALID');
    this.storage = {
      stateDirectory: options.stateDirectory,
      ...(options.ownerUid === undefined ? {} : { ownerUid: options.ownerUid }),
      ...(options.groupGid === undefined ? {} : { groupGid: options.groupGid })
    };
    this.stagingKey = options.stagingKey;
    this.draftTtl = ttl(options.draftTtlMs, DRAFT_TTL_MS);
    this.stagedTtl = ttl(options.stagedTtlMs, STAGED_TTL_MS);
    this.randomBytes = options.randomBytes;
  }

  async replaceDraft<T>(input: DraftWriteInput<T>): Promise<void> {
    await this.writeDraft(input);
  }

  async saveStaged<T>(input: DraftWriteInput<T>): Promise<void> {
    await this.writeStaged(input);
  }

  async readDraft<T>(changeId: string, now?: Date): Promise<T | null> {
    return this.readValue<T>('drafts', 'draft', changeId, asDate(now));
  }

  async readStaged<T>(changeId: string, now?: Date): Promise<T | null> {
    return this.readValue<T>('staged', 'staged', changeId, asDate(now));
  }

  async deleteDraft(changeId: string): Promise<boolean> {
    return this.deleteValue('drafts', changeId);
  }

  async deleteStaged(changeId: string): Promise<boolean> {
    return this.deleteValue('staged', changeId);
  }

  async sealDraft(input: SealDraftInput): Promise<void> {
    const now = asDate(input.now);
    const entries = await readArtifactIndex(this.storage, 'drafts');
    const entry = entries.find((candidate) => candidate.id === input.changeId);
    if (!entry || entry.kind !== 'draft' || isExpired(entry, now)) fail('DRAFT_NOT_FOUND');
    const value = await this.readValueFromEntry<unknown>('drafts', entry, now);
    await this.writeValue({
      directory: 'staged',
      kind: 'staged',
      id: entry.id,
      changeId: entry.changeId,
      appId: entry.appId,
      catalogVersion: entry.catalogVersion,
      manifestVersion: entry.manifestVersion,
      value,
      now,
      ttlMs: this.stagedTtl
    });
    await this.deleteDraft(input.changeId);
  }

  async listEntries(kind: 'draft' | 'staged'): Promise<ArtifactIndexEntry[]> {
    return readArtifactIndex(this.storage, kind === 'draft' ? 'drafts' : 'staged');
  }

  async removeExpired(kind: 'draft' | 'staged', now: Date): Promise<string[]> {
    const directory = kind === 'draft' ? 'drafts' : 'staged';
    const entries = await readArtifactIndex(this.storage, directory);
    const expired = entries.filter((entry) => entry.kind === kind && isExpired(entry, now));
    const deleted: string[] = [];
    for (const entry of expired) {
      if (await deleteSecureArtifact(this.storage, directory, entry.id)) deleted.push(entry.id);
    }
    if (expired.length > 0) {
      await updateArtifactIndex(this.storage, directory, (current) =>
        current.filter((entry) => !expired.some((candidate) => candidate.id === entry.id))
      );
    }
    return deleted.sort();
  }

  private async writeDraft<T>(input: DraftWriteInput<T>): Promise<void> {
    const now = asDate(input.now);
    await this.writeValue({
      directory: 'drafts',
      kind: 'draft',
      id: input.changeId,
      changeId: input.changeId,
      appId: input.appId,
      catalogVersion: input.catalogVersion,
      manifestVersion: input.manifestVersion,
      value: input.value,
      now,
      ttlMs: this.draftTtl
    });
  }

  private async writeStaged<T>(input: DraftWriteInput<T>): Promise<void> {
    const now = asDate(input.now);
    await this.writeValue({
      directory: 'staged',
      kind: 'staged',
      id: input.changeId,
      changeId: input.changeId,
      appId: input.appId,
      catalogVersion: input.catalogVersion,
      manifestVersion: input.manifestVersion,
      value: input.value,
      now,
      ttlMs: this.stagedTtl
    });
  }

  private async writeValue<T>(input: {
    directory: 'drafts' | 'staged';
    kind: 'draft' | 'staged';
    id: string;
    changeId: string;
    appId: string;
    catalogVersion: string;
    manifestVersion: string;
    value: T;
    now: Date;
    ttlMs: number;
  }): Promise<void> {
    await ensureStorageDirectories(this.storage);
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);
    const artifact = encryptEnvelope({
      key: this.stagingKey,
      header: {
        envelopeType: input.kind,
        purpose: 'staging',
        changeId: input.changeId,
        appId: input.appId,
        catalogVersion: input.catalogVersion,
        manifestVersion: input.manifestVersion,
        keyId: this.stagingKey.keyId,
        keyVersion: this.stagingKey.keyVersion,
        expiresAt: expiresAt.toISOString()
      },
      plaintext: encodeValue(input.value),
      ...(this.randomBytes === undefined ? {} : { randomBytes: this.randomBytes })
    });
    await writeAtomicSecureArtifact(this.storage, input.directory, input.id, artifact);
    const metadata = entryFor({ ...input, expiresAt });
    await updateArtifactIndex(this.storage, input.directory, (entries) => [
      ...entries.filter((entry) => entry.id !== input.id),
      metadata
    ]);
  }

  private async readValue<T>(
    directory: 'drafts' | 'staged',
    kind: 'draft' | 'staged',
    id: string,
    now: Date
  ): Promise<T | null> {
    const entries = await readArtifactIndex(this.storage, directory);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) {
      try {
        await readSecureArtifact(this.storage, directory, id);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ARTIFACT_NOT_FOUND') {
          return null;
        }
        throw error;
      }
      fail('DRAFT_CORRUPT');
    }
    if (entry.kind !== kind || isExpired(entry, now)) return null;
    return this.readValueFromEntry<T>(directory, entry, now);
  }

  private async readValueFromEntry<T>(
    directory: 'drafts' | 'staged',
    entry: ArtifactIndexEntry,
    now: Date
  ): Promise<T> {
    const artifact = await readSecureArtifact(this.storage, directory, entry.id);
    const plaintext = decryptEnvelope({
      artifact,
      keys: [this.stagingKey],
      now,
      expected: {
        envelopeType: entry.kind,
        purpose: 'staging',
        changeId: entry.changeId,
        appId: entry.appId,
        catalogVersion: entry.catalogVersion,
        manifestVersion: entry.manifestVersion
      }
    });
    return decodeStoredValue<T>(plaintext);
  }

  private async deleteValue(directory: 'drafts' | 'staged', id: string): Promise<boolean> {
    const deleted = await deleteSecureArtifact(this.storage, directory, id);
    if (!deleted) return false;
    await updateArtifactIndex(this.storage, directory, (entries) =>
      entries.filter((entry) => entry.id !== id)
    );
    return true;
  }
}
