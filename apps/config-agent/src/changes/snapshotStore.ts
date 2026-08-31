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
import { decryptEnvelope, encryptEnvelope, type EnvelopeKey } from '../crypto/encryptedEnvelope.js';
import { decodeStoredValue } from './draftStore.js';

export const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type SnapshotStoreOptions = SecureStorageOptions &
  Readonly<{
    snapshotKey: EnvelopeKey;
    retentionMs?: number;
    randomBytes?: (size: number) => Uint8Array;
  }>;

export type SnapshotWriteInput<T> = Readonly<{
  snapshotId: string;
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  value: T;
  now?: Date;
}>;

export type SnapshotRetentionEntry = Readonly<{
  snapshotId: string;
  changeId: string;
  appId: string;
  expiresAt: string;
  retention: 'rollback_failed';
}>;

export class SnapshotStoreError extends Error {
  readonly code:
    | 'SNAPSHOT_INVALID'
    | 'SNAPSHOT_NOT_FOUND'
    | 'SNAPSHOT_CORRUPT'
    | 'SNAPSHOT_KEY_INVALID';

  constructor(code: SnapshotStoreError['code']) {
    super(code);
    this.name = 'SnapshotStoreError';
    this.code = code;
  }
}

function fail(code: SnapshotStoreError['code']): never {
  throw new SnapshotStoreError(code);
}

function asDate(value: Date | undefined): Date {
  const date = value ?? new Date();
  if (!Number.isFinite(date.getTime())) fail('SNAPSHOT_INVALID');
  return date;
}

function retention(value: number | undefined): number {
  const result = value ?? SNAPSHOT_RETENTION_MS;
  if (!Number.isSafeInteger(result) || result <= 0 || result > SNAPSHOT_RETENTION_MS) {
    fail('SNAPSHOT_INVALID');
  }
  return result;
}

function isExpired(entry: ArtifactIndexEntry, now: Date): boolean {
  return Date.parse(entry.expiresAt) <= now.getTime();
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
    if (serialized === undefined) fail('SNAPSHOT_INVALID');
    return Buffer.from(serialized, 'utf8');
  } catch (error) {
    if (error instanceof SnapshotStoreError) throw error;
    fail('SNAPSHOT_INVALID');
  }
}

export class SnapshotStore {
  private readonly storage: SecureStorageOptions;
  private readonly snapshotKey: EnvelopeKey;
  private readonly retentionMs: number;
  private readonly randomBytes: ((size: number) => Uint8Array) | undefined;

  constructor(options: SnapshotStoreOptions) {
    if (options.snapshotKey.purpose !== 'snapshot') fail('SNAPSHOT_KEY_INVALID');
    this.storage = {
      stateDirectory: options.stateDirectory,
      ...(options.ownerUid === undefined ? {} : { ownerUid: options.ownerUid }),
      ...(options.groupGid === undefined ? {} : { groupGid: options.groupGid })
    };
    this.snapshotKey = options.snapshotKey;
    this.retentionMs = retention(options.retentionMs);
    this.randomBytes = options.randomBytes;
  }

  async createSnapshot<T>(input: SnapshotWriteInput<T>): Promise<void> {
    const now = asDate(input.now);
    await ensureStorageDirectories(this.storage);
    const expiresAt = new Date(now.getTime() + this.retentionMs);
    const artifact = encryptEnvelope({
      key: this.snapshotKey,
      header: {
        envelopeType: 'snapshot',
        purpose: 'snapshot',
        changeId: input.changeId,
        appId: input.appId,
        catalogVersion: input.catalogVersion,
        manifestVersion: input.manifestVersion,
        keyId: this.snapshotKey.keyId,
        keyVersion: this.snapshotKey.keyVersion,
        expiresAt: expiresAt.toISOString()
      },
      plaintext: encodeValue(input.value),
      ...(this.randomBytes === undefined ? {} : { randomBytes: this.randomBytes })
    });
    await writeAtomicSecureArtifact(this.storage, 'snapshots', input.snapshotId, artifact);
    const entry: ArtifactIndexEntry = {
      id: input.snapshotId,
      kind: 'snapshot',
      changeId: input.changeId,
      appId: input.appId,
      catalogVersion: input.catalogVersion,
      manifestVersion: input.manifestVersion,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      retention: 'normal'
    };
    await updateArtifactIndex(this.storage, 'snapshots', (entries) => [
      ...entries.filter((candidate) => candidate.id !== input.snapshotId),
      entry
    ]);
  }

  async readSnapshot<T>(snapshotId: string, now?: Date): Promise<T | null> {
    const current = asDate(now);
    const entries = await readArtifactIndex(this.storage, 'snapshots');
    const entry = entries.find((candidate) => candidate.id === snapshotId);
    if (!entry || entry.kind !== 'snapshot') return null;
    const evidence = entry.retention === 'rollback_failed';
    if (!evidence && isExpired(entry, current)) return null;
    const artifact = await readSecureArtifact(this.storage, 'snapshots', snapshotId);
    const plaintext = decryptEnvelope({
      artifact,
      keys: [this.snapshotKey],
      now: current,
      allowExpired: evidence,
      expected: {
        envelopeType: 'snapshot',
        purpose: 'snapshot',
        changeId: entry.changeId,
        appId: entry.appId,
        catalogVersion: entry.catalogVersion,
        manifestVersion: entry.manifestVersion
      }
    });
    try {
      return decodeStoredValue<T>(plaintext);
    } catch {
      fail('SNAPSHOT_CORRUPT');
    }
  }

  async markRollbackFailed(snapshotId: string): Promise<void> {
    const entries = await readArtifactIndex(this.storage, 'snapshots');
    if (!entries.some((entry) => entry.id === snapshotId && entry.kind === 'snapshot')) {
      fail('SNAPSHOT_NOT_FOUND');
    }
    await updateArtifactIndex(this.storage, 'snapshots', (current) =>
      current.map((entry) =>
        entry.id === snapshotId ? { ...entry, retention: 'rollback_failed' as const } : entry
      )
    );
  }

  async releaseRollbackEvidence(snapshotId: string, now?: Date): Promise<void> {
    const current = asDate(now);
    const entries = await readArtifactIndex(this.storage, 'snapshots');
    if (!entries.some((entry) => entry.id === snapshotId && entry.kind === 'snapshot')) {
      fail('SNAPSHOT_NOT_FOUND');
    }
    await updateArtifactIndex(this.storage, 'snapshots', (all) =>
      all.map((entry) =>
        entry.id === snapshotId
          ? {
              ...entry,
              retention: 'normal' as const,
              expiresAt:
                Date.parse(entry.expiresAt) <= current.getTime()
                  ? current.toISOString()
                  : entry.expiresAt
            }
          : entry
      )
    );
  }

  async getRetentionEntries(): Promise<SnapshotRetentionEntry[]> {
    const entries = await readArtifactIndex(this.storage, 'snapshots');
    return entries
      .filter((entry) => entry.kind === 'snapshot' && entry.retention === 'rollback_failed')
      .map((entry) => ({
        snapshotId: entry.id,
        changeId: entry.changeId,
        appId: entry.appId,
        expiresAt: entry.expiresAt,
        retention: 'rollback_failed' as const
      }));
  }

  async listEntries(): Promise<ArtifactIndexEntry[]> {
    return readArtifactIndex(this.storage, 'snapshots');
  }

  async removeExpired(
    now: Date
  ): Promise<{ deletedSnapshotIds: string[]; retainedRollbackFailedIds: string[] }> {
    const entries = await readArtifactIndex(this.storage, 'snapshots');
    const deletedSnapshotIds: string[] = [];
    const retainedRollbackFailedIds = entries
      .filter((entry) => entry.kind === 'snapshot' && entry.retention === 'rollback_failed')
      .map((entry) => entry.id)
      .sort();
    const expired = entries.filter(
      (entry) => entry.kind === 'snapshot' && entry.retention === 'normal' && isExpired(entry, now)
    );
    for (const entry of expired) {
      if (await deleteSecureArtifact(this.storage, 'snapshots', entry.id)) {
        deletedSnapshotIds.push(entry.id);
      }
    }
    if (expired.length > 0) {
      await updateArtifactIndex(this.storage, 'snapshots', (current) =>
        current.filter((entry) => !expired.some((candidate) => candidate.id === entry.id))
      );
    }
    return { deletedSnapshotIds: deletedSnapshotIds.sort(), retainedRollbackFailedIds };
  }
}
