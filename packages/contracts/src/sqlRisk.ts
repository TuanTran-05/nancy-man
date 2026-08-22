export type SqlRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SqlRecoverability = 'REVERSIBLE' | 'PITR_ONLY' | 'NO_AUTOMATIC_UNDO';

export type SqlExecutionCategory =
  | 'DML'
  | 'TRANSACTIONAL_DDL'
  | 'NON_TRANSACTIONAL'
  | 'TRUNCATE'
  | 'DROP'
  | 'JOURNAL_BYPASS'
  | 'UNPARSED'
  | 'CLUSTER';

export type ExecutionGate = {
  risk: SqlRisk;
  recoverability: SqlRecoverability;
  requiresRecentMfa: boolean;
  requiresRestorePoint: boolean;
  confirmationPhrase: string;
  warnings: string[];
  ownerOnly: boolean;
};

export type SqlRiskInput = {
  executionKey: string;
  category: SqlExecutionCategory;
  registeredTable: boolean;
  hasWhere?: boolean;
  affectedRows: number;
  tableRows: number;
  cascadeRows?: number;
};

export type SqlConfirmationReceipt = {
  executionKey: string;
  previewChecksum: string;
  userId: string;
  sessionId: string;
  phrase: string;
  issuedAt: string;
  expiresAt: string;
};

export function confirmationPhrase(input: { executionKey: string; risk: SqlRisk }): string {
  if (input.risk === 'CRITICAL') return `BREAK GLASS ${input.executionKey}`;
  if (input.risk === 'HIGH') return `EXECUTE PRODUCTION ${input.executionKey}`;
  return `EXECUTE ${input.executionKey}`;
}
