import type { DocumentStore } from '@/server/db/documentStore.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'export'
  | 'import'
  | 'password_reset'
  | 'status_change'
  | 'enrollment_correction'
  | 'admin_data_read';

export interface AuditLogEntry {
  id?: string;
  userId: string;
  userRole: string;
  userName?: string;
  action: AuditAction;
  collection: string;
  documentId: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  timestamp: string;
}

export type CriticalAuditCategory =
  | 'finance'
  | 'payment'
  | 'auth'
  | 'role'
  | 'attendance_correction'
  | 'student_sensitive_update'
  | 'student_enrollment';

let auditFailureCount = 0;
const AUDIT_FAILURE_ALERT_THRESHOLD = 10;

/**
 * Write an audit log entry to DocumentStore.
 * Returns true on success, false on failure.
 * Does not throw — callers can choose how to handle failures.
 */
export async function writeAuditLog(
  db: DocumentStore,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): Promise<boolean> {
  try {
    const data = sanitizeForDocumentStore({
      ...entry,
      timestamp: new Date().toISOString(),
    }) as Record<string, unknown>;

    await db.collection('audit_logs').add(data);
    if (auditFailureCount > 0) {
      console.info(`[AUDIT] Recovered after ${auditFailureCount} consecutive failures`);
      auditFailureCount = 0;
    }
    return true;
  } catch (err) {
    auditFailureCount++;
    console.error(`[AUDIT] Failed to write audit log (failure #${auditFailureCount}):`, err);
    if (auditFailureCount >= AUDIT_FAILURE_ALERT_THRESHOLD) {
      console.error(
        `[AUDIT] ALERT: ${auditFailureCount} consecutive audit log failures. ` +
          'Audit trail may be incomplete. Check DocumentStore connectivity and quotas.'
      );
    }
    return false;
  }
}

/**
 * Stages an audit entry inside a caller's transaction.
 *
 * The distinction from `writeAuditLog` matters for decisions that authorize a
 * write rather than merely describe one. An admin override of the duplicate
 * guard is the record of why a second profile for the same human was allowed;
 * written afterwards and best-effort, it can be lost while the profile it
 * justifies survives. Staged in the transaction, either both land or neither
 * does — and a failure here fails the creation, as it should.
 */
export function writeAuditLogInTransaction(
  tx: { create: (ref: unknown, data: unknown) => unknown },
  db: DocumentStore,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): void {
  const data = sanitizeForDocumentStore({
    ...entry,
    timestamp: new Date().toISOString(),
  }) as Record<string, unknown>;
  tx.create(db.collection('audit_logs').doc(), data);
}

export async function writeCriticalAuditLog(
  db: DocumentStore,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): Promise<void> {
  const ok = await writeAuditLog(db, entry);
  if (!ok) {
    throw new Error(`Critical audit log failed for ${entry.collection}/${entry.documentId}`);
  }
}

export async function writeRequiredAuditLog(
  db: DocumentStore,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>,
  _category?: CriticalAuditCategory
): Promise<void> {
  const ok = await writeAuditLog(db, entry);
  if (!ok) {
    throw Object.assign(
      new Error(`Critical audit log failed for ${entry.collection}/${entry.documentId}`),
      {
        statusCode: 503,
        code: 'critical_audit_failed',
      }
    );
  }
}

export function writeOptionalAuditLog(
  db: DocumentStore,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>
): void {
  const timer = setTimeout(() => {
    void writeAuditLog(db, entry);
  }, 0);
  const maybeNodeTimer = timer as unknown as { unref?: () => void };
  if (typeof maybeNodeTimer.unref === 'function') {
    maybeNodeTimer.unref();
  }
}

function sanitizeForDocumentStore(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitized = sanitizeForDocumentStore(item);
      return sanitized === undefined ? null : sanitized;
    });
  }
  if (typeof value !== 'object') return value;
  if (value.constructor !== Object) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitizeForDocumentStore(item)] as const)
      .filter(([, item]) => item !== undefined)
  );
}

/**
 * Compute a diff of changed fields between old and new data.
 * Only includes fields that actually changed.
 */
export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldsToTrack?: string[]
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const keys = fieldsToTrack || new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (key === 'updatedAt' || key === 'createdAt') continue;
    const bVal = before[key];
    const aVal = after[key];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changes[key] = { before: bVal, after: aVal };
    }
  }
  return changes;
}

export function getClientIp(req: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === 'string') {
    return forwardedValue.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}
