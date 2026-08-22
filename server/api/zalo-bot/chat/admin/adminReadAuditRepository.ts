import crypto from 'node:crypto';
import type { DocumentStore } from '@/server/db/documentStore.js';

export type AdminReadSensitivityTier = 'low' | 'medium' | 'high' | 'critical_pii';
export type AdminReadAccessStage = 'started' | 'completed';

export type AdminReadAuditParams = {
  actorUid: string;
  actorRole?: string;
  messageId: string;
  accessStage: AdminReadAccessStage;
  queryKind: string;
  sensitivityTier: AdminReadSensitivityTier;
  canonicalIds?: string[];
  classIds?: string[];
  period?: string;
  resultCount?: number;
};

export type AdminReadAuditOptions = {
  hmacSecret: string;
  now?: Date;
};

export function makeAdminReadAuditDocId(
  messageId: string,
  accessStage: AdminReadAccessStage,
  queryKind: string
): string {
  const raw = `${messageId}:${accessStage}:${queryKind}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `admin_read_${accessStage}_${hash}`;
}

export function computeAdminAuditFingerprint(
  params: AdminReadAuditParams,
  hmacSecret: string
): string {
  if (!hmacSecret || hmacSecret.length < 16) {
    const error = new Error('Admin read audit HMAC secret is missing or too short') as Error & {
      code?: string;
    };
    error.code = 'audit_failed';
    throw error;
  }
  const canonicalIds = Array.isArray(params.canonicalIds) ? [...params.canonicalIds].sort() : [];
  const classIds = Array.isArray(params.classIds) ? [...params.classIds].sort() : [];
  const raw = [
    'admin-read-audit:v1',
    params.actorUid,
    params.actorRole ?? 'admin',
    params.messageId,
    params.accessStage,
    params.queryKind,
    params.sensitivityTier,
    canonicalIds.join(','),
    classIds.join(','),
    params.period ?? '',
    params.resultCount ?? '',
  ].join('|');
  return crypto.createHmac('sha256', hmacSecret).update(raw).digest('hex');
}

/**
 * Records an immutable, append-only security audit log for admin sensitive data reads.
 * Idempotent: identical retry returns success.
 * Fail-closed: throws an error with code 'audit_failed' if audit cannot be recorded.
 */
export async function recordAdminDataReadAudit(
  db: DocumentStore,
  params: AdminReadAuditParams,
  options: AdminReadAuditOptions
): Promise<void> {
  const docId = makeAdminReadAuditDocId(params.messageId, params.accessStage, params.queryKind);
  const fingerprint = computeAdminAuditFingerprint(params, options.hmacSecret);
  const docRef = db.collection('audit_logs').doc(docId);
  const timestamp = (options.now ?? new Date()).toISOString();

  try {
    const metadata: Record<string, unknown> = {
      fingerprint,
      fingerprintVersion: 'hmac-sha256:v1',
      messageId: params.messageId,
      accessStage: params.accessStage,
      queryKind: params.queryKind,
      sensitivityTier: params.sensitivityTier,
      canonicalIdCount: params.canonicalIds?.length ?? 0,
      classIdCount: params.classIds?.length ?? 0,
      timestamp,
    };

    if (params.canonicalIds && params.canonicalIds.length > 0) {
      metadata.canonicalIds = params.canonicalIds.slice(0, 20);
    }
    if (params.classIds && params.classIds.length > 0) {
      metadata.classIds = params.classIds.slice(0, 10);
    }
    if (params.period) {
      metadata.period = params.period;
    }
    if (params.resultCount !== undefined) {
      metadata.resultCount = params.resultCount;
    }

    const auditDocument = {
      userId: params.actorUid,
      userRole: params.actorRole ?? 'admin',
      action: 'admin_data_read',
      collection: 'zalo_bot_admin_reads',
      documentId: docId,
      metadata,
      timestamp,
    };

    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(docRef);
      if (existingSnap.exists) {
        const data = existingSnap.data();
        if (data?.metadata?.fingerprint === fingerprint) {
          return;
        }
        const collisionErr = new Error(`Audit collision for key ${docId}`) as Error & {
          code?: string;
        };
        collisionErr.code = 'audit_failed';
        throw collisionErr;
      }
      tx.create(docRef, auditDocument);
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'audit_failed'
    ) {
      throw err;
    }
    const auditErr = new Error(
      `Failed to write admin read audit for ${params.queryKind}:${params.accessStage}`
    ) as Error & { code?: string; cause?: unknown };
    auditErr.code = 'audit_failed';
    auditErr.cause = err;
    throw auditErr;
  }
}
