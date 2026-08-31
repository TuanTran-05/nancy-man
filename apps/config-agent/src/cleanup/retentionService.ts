import {
  deleteSecureArtifact,
  ensureStorageDirectories,
  readArtifactIndex,
  updateArtifactIndex,
  type SecureStorageOptions
} from '../changes/artifactStorage.js';

export const RETENTION_DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
export const RETENTION_STAGED_TTL_MS = 24 * 60 * 60 * 1_000;
export const RETENTION_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type CleanupSummary = Readonly<{
  deletedDraftIds: string[];
  deletedStagedIds: string[];
  deletedSnapshotIds: string[];
  retainedRollbackFailedIds: string[];
}>;

export type RetentionServiceOptions = SecureStorageOptions &
  Readonly<{
    onCleanup?: (summary: CleanupSummary) => void | Promise<void>;
  }>;

export class RetentionService {
  private readonly storage: SecureStorageOptions;
  private readonly onCleanup: ((summary: CleanupSummary) => void | Promise<void>) | undefined;

  constructor(options: RetentionServiceOptions) {
    this.storage = {
      stateDirectory: options.stateDirectory,
      ...(options.ownerUid === undefined ? {} : { ownerUid: options.ownerUid }),
      ...(options.groupGid === undefined ? {} : { groupGid: options.groupGid })
    };
    this.onCleanup = options.onCleanup;
  }

  async cleanup(now = new Date()): Promise<CleanupSummary> {
    if (!Number.isFinite(now.getTime())) throw new Error('RETENTION_INVALID_TIME');
    await ensureStorageDirectories(this.storage);
    const [drafts, staged, snapshots] = await Promise.all([
      this.removeExpiredDirectory('drafts', now, (entry) => entry.kind === 'draft'),
      this.removeExpiredDirectory('staged', now, (entry) => entry.kind === 'staged'),
      this.removeExpiredDirectory(
        'snapshots',
        now,
        (entry) => entry.kind === 'snapshot' && entry.retention === 'normal'
      )
    ]);
    const snapshotEntries = await readArtifactIndex(this.storage, 'snapshots');
    const summary: CleanupSummary = Object.freeze({
      deletedDraftIds: drafts,
      deletedStagedIds: staged,
      deletedSnapshotIds: snapshots,
      retainedRollbackFailedIds: snapshotEntries
        .filter((entry) => entry.kind === 'snapshot' && entry.retention === 'rollback_failed')
        .map((entry) => entry.id)
        .sort()
    });
    await this.onCleanup?.(summary);
    return summary;
  }

  private async removeExpiredDirectory(
    directory: 'drafts' | 'staged' | 'snapshots',
    now: Date,
    eligible: (entry: Awaited<ReturnType<typeof readArtifactIndex>>[number]) => boolean
  ): Promise<string[]> {
    const entries = await readArtifactIndex(this.storage, directory);
    const expired = entries.filter(
      (entry) => eligible(entry) && Date.parse(entry.expiresAt) <= now.getTime()
    );
    const deleted: string[] = [];
    const removedIds: string[] = [];
    for (const entry of expired) {
      if (await deleteSecureArtifact(this.storage, directory, entry.id)) {
        deleted.push(entry.id);
      }
      removedIds.push(entry.id);
    }
    if (removedIds.length > 0) {
      await updateArtifactIndex(this.storage, directory, (current) =>
        current.filter((entry) => !removedIds.includes(entry.id))
      );
    }
    return deleted.sort();
  }
}
