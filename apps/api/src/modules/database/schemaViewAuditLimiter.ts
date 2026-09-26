import { captureOpsException } from '../../telemetry/runtimeTelemetry.js';

import type { DatabaseTargetId } from '../../../../../packages/contracts/src/databaseExplorer.js';

export type SchemaViewAuditKey = {
  actorUserId: string;
  targetId: DatabaseTargetId;
  schemaChecksum: string;
};

// Process-local by design: production currently runs a single API runtime.
export class SchemaViewAuditLimiter {
  private readonly lastWrittenAt = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly now: () => Date;

  constructor(input: { now?: () => Date; windowMs?: number } = {}) {
    this.now = input.now ?? (() => new Date());
    this.windowMs = input.windowMs ?? 60_000;
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new Error('SCHEMA_VIEW_AUDIT_LIMIT_INVALID_WINDOW');
    }
  }

  private readonly windowMs: number;

  async run(input: SchemaViewAuditKey, append: () => Promise<unknown>): Promise<void> {
    const currentTime = this.now().getTime();
    if (!Number.isFinite(currentTime)) throw new Error('SCHEMA_VIEW_AUDIT_CLOCK_UNAVAILABLE');

    for (const [key, lastWritten] of this.lastWrittenAt) {
      if (currentTime - lastWritten >= this.windowMs) this.lastWrittenAt.delete(key);
    }

    const key = JSON.stringify([input.actorUserId, input.targetId, input.schemaChecksum]);
    const lastWrittenAt = this.lastWrittenAt.get(key);
    if (lastWrittenAt !== undefined && currentTime - lastWrittenAt < this.windowMs) return;

    const pending = this.pending.get(key);
    if (pending) {
      await pending;
      return this.run(input, append);
    }

    let resolvePending!: () => void;
    let rejectPending!: (error: unknown) => void;
    const pendingWrite = new Promise<void>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    void pendingWrite.catch(() => {
      // telemetry-ignore: the originating await below terminally captures the same rejection
      return undefined;
    });
    this.pending.set(key, pendingWrite);
    try {
      await append();
      const writtenAt = this.now().getTime();
      if (!Number.isFinite(writtenAt)) throw new Error('SCHEMA_VIEW_AUDIT_CLOCK_UNAVAILABLE');
      this.lastWrittenAt.set(key, writtenAt);
      resolvePending();
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'api',
        status: 500,
        errorMode: 'code-only'
      });
      rejectPending(error);
      throw error;
    } finally {
      this.pending.delete(key);
    }
  }
}
