import { describe, expect, it } from 'vitest';

import { classifyRisk, requiredConfirmation } from './riskPolicy.js';

describe('SQL risk policy', () => {
  it('keeps a bounded registered DML correction low-risk and reversible', () => {
    expect(
      classifyRisk({
        executionKey: 'SQL-20260822-01HLOW',
        category: 'DML',
        registeredTable: true,
        hasWhere: true,
        affectedRows: 1,
        tableRows: 500
      })
    ).toEqual({
      risk: 'LOW',
      recoverability: 'REVERSIBLE',
      requiresRecentMfa: false,
      requiresRestorePoint: false,
      confirmationPhrase: 'EXECUTE SQL-20260822-01HLOW',
      warnings: [],
      ownerOnly: false
    });
  });

  it('raises unbounded or broad corrections to high-risk production confirmation', () => {
    expect(
      classifyRisk({
        executionKey: 'SQL-20260822-01HHIGH',
        category: 'DML',
        registeredTable: true,
        hasWhere: false,
        affectedRows: 101,
        tableRows: 900
      })
    ).toMatchObject({
      risk: 'HIGH',
      recoverability: 'REVERSIBLE',
      requiresRecentMfa: true,
      requiresRestorePoint: true,
      confirmationPhrase: 'EXECUTE PRODUCTION SQL-20260822-01HHIGH',
      ownerOnly: false
    });
  });

  it('does not label a DML preview low-risk when table impact cannot be measured', () => {
    expect(
      classifyRisk({
        executionKey: 'SQL-20260822-01HUNKNOWN',
        category: 'DML',
        registeredTable: true,
        hasWhere: true,
        affectedRows: 1,
        tableRows: null
      })
    ).toMatchObject({
      risk: 'HIGH',
      recoverability: 'REVERSIBLE',
      requiresRecentMfa: true,
      requiresRestorePoint: true,
      confirmationPhrase: 'EXECUTE PRODUCTION SQL-20260822-01HUNKNOWN'
    });
  });

  it('classifies destructive, evidence-bypass, and unparsed commands as owner-only break-glass', () => {
    for (const category of ['TRUNCATE', 'JOURNAL_BYPASS', 'UNPARSED', 'CLUSTER'] as const) {
      expect(
        classifyRisk({
          executionKey: 'SQL-20260822-01HCRIT',
          category,
          registeredTable: false,
          affectedRows: 0,
          tableRows: 0
        })
      ).toMatchObject({
        risk: 'CRITICAL',
        recoverability: 'PITR_ONLY',
        requiresRecentMfa: true,
        requiresRestorePoint: true,
        confirmationPhrase: 'BREAK GLASS SQL-20260822-01HCRIT',
        ownerOnly: true
      });
    }
  });

  it('never labels unregistered DML as reversible', () => {
    expect(
      classifyRisk({
        executionKey: 'SQL-20260822-01HUNREG',
        category: 'DML',
        registeredTable: false,
        hasWhere: true,
        affectedRows: 1,
        tableRows: 10
      })
    ).toMatchObject({
      risk: 'CRITICAL',
      recoverability: 'PITR_ONLY',
      confirmationPhrase: 'BREAK GLASS SQL-20260822-01HUNREG',
      ownerOnly: true
    });
  });

  it('returns a phrase that is deterministic for the exact execution', () => {
    expect(requiredConfirmation({ executionKey: 'SQL-20260822-01HXYZ', risk: 'MEDIUM' })).toBe(
      'EXECUTE SQL-20260822-01HXYZ'
    );
    expect(requiredConfirmation({ executionKey: 'SQL-20260822-01HXYZ', risk: 'HIGH' })).toBe(
      'EXECUTE PRODUCTION SQL-20260822-01HXYZ'
    );
  });
});
