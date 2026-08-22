export interface AuditLogEntry {
  id: string;
  userId: string;
  userRole: string;
  userName?: string;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'login'
    | 'logout'
    | 'export'
    | 'import'
    | 'password_reset'
    | 'status_change';
  collection: string;
  documentId: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  timestamp: string;
}
