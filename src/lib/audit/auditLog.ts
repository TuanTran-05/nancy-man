import { apiRequest } from '../api/apiClient';

type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'export'
  | 'import'
  | 'password_reset'
  | 'status_change';

interface AuditLogEntry {
  userId?: string;
  userRole?: string;
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

/**
 * Log an audit activity from the client side.
 * Fails silently to avoid disrupting the main operation.
 */
export async function logAuditActivity(
  action: AuditAction,
  collectionName: string,
  documentId: string,
  changes?: Record<string, { before: unknown; after: unknown }>,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const entry: Omit<AuditLogEntry, 'timestamp'> = {
      action,
      collection: collectionName,
      documentId,
    };

    if (changes && Object.keys(changes).length > 0) {
      entry.changes = changes;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }

    await apiRequest('/api/v1/audit/log', {
      method: 'POST',
      body: entry,
    });
  } catch (err) {
    console.error('[AUDIT] Failed to write audit log:', err);
  }
}
