export function classifySeverity(input: {
  source: string;
  errorCode: string;
  affectedUsers?: number;
  retryable?: boolean;
  handled?: boolean;
}): 'critical' | 'high' | 'medium' | 'low' {
  if (input.handled) return 'low';
  if (/(DB_UNAVAILABLE|LOGIN_UNAVAILABLE|DATA_LOSS|PITR_|WAL_|BACKUP_)/.test(input.errorCode)) {
    return 'critical';
  }
  if (
    /(INVOICE|PAYMENT|FINANCE|CORE_|AUTH_)/.test(input.errorCode) ||
    (input.affectedUsers ?? 0) >= 5 ||
    input.source === 'database' ||
    input.source === 'process'
  ) {
    return 'high';
  }
  return input.retryable ? 'medium' : 'low';
}
