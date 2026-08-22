import type {
  ExecutionGate,
  SqlRisk,
  SqlRiskInput
} from '../../../../packages/contracts/src/sqlRisk.js';
import { confirmationPhrase } from '../../../../packages/contracts/src/sqlRisk.js';

export function requiredConfirmation(input: { executionKey: string; risk: SqlRisk }): string {
  return confirmationPhrase(input);
}

function gate(
  input: Omit<ExecutionGate, 'confirmationPhrase'> & { executionKey: string }
): ExecutionGate {
  const { executionKey, ...gate } = input;
  return {
    ...gate,
    confirmationPhrase: requiredConfirmation({ executionKey, risk: input.risk })
  };
}

function affectsMoreThan(input: SqlRiskInput, fraction: number): boolean {
  return input.tableRows > 0 && input.affectedRows / input.tableRows > fraction;
}

export function classifyRisk(input: SqlRiskInput): ExecutionGate {
  const affectedRows = Math.max(0, input.affectedRows);
  const cascades = Math.max(0, input.cascadeRows ?? 0);

  if (
    input.category === 'TRUNCATE' ||
    input.category === 'DROP' ||
    input.category === 'JOURNAL_BYPASS' ||
    input.category === 'UNPARSED' ||
    input.category === 'CLUSTER' ||
    (input.category === 'DML' && !input.registeredTable) ||
    affectedRows > 1_000 ||
    affectsMoreThan(input, 0.25)
  ) {
    return gate({
      executionKey: input.executionKey,
      risk: 'CRITICAL',
      recoverability: 'PITR_ONLY',
      requiresRecentMfa: true,
      requiresRestorePoint: true,
      warnings: [
        input.category === 'DML' && !input.registeredTable
          ? 'The target table is not registered for complete row journaling.'
          : 'This operation requires verified point-in-time recovery evidence.'
      ],
      ownerOnly: true
    });
  }

  const broadDml =
    input.category === 'DML' &&
    (input.hasWhere === false || affectedRows > 100 || affectsMoreThan(input, 0.1));
  const broadCascade = cascades > 100;
  const schemaChange =
    input.category === 'TRANSACTIONAL_DDL' || input.category === 'NON_TRANSACTIONAL';
  if (broadDml || broadCascade || schemaChange) {
    const warnings: string[] = [];
    if (input.hasWhere === false)
      warnings.push('No WHERE clause; preview must prove the affected row set.');
    if (affectedRows > 100 || affectsMoreThan(input, 0.1))
      warnings.push('The change has broad table impact.');
    if (broadCascade) warnings.push('The change cascades to more than 100 rows.');
    if (schemaChange)
      warnings.push('Schema changes require a restore point and post-change verification.');

    return gate({
      executionKey: input.executionKey,
      risk: 'HIGH',
      recoverability: input.category === 'DML' ? 'REVERSIBLE' : 'PITR_ONLY',
      requiresRecentMfa: true,
      requiresRestorePoint: true,
      warnings,
      ownerOnly: false
    });
  }

  return gate({
    executionKey: input.executionKey,
    risk: 'LOW',
    recoverability: 'REVERSIBLE',
    requiresRecentMfa: false,
    requiresRestorePoint: false,
    warnings: [],
    ownerOnly: false
  });
}
