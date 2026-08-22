import { describe, expect, it, vi } from 'vitest';

const moduleLoads = vi.hoisted(() => ({
  exports: 0,
  finance: 0,
  dashboard: 0,
  reconcile: 0,
  outboxHandlers: 0,
}));

vi.mock('../../server/api/lib/services/fullExportService.js', () => {
  moduleLoads.exports += 1;
  return {
    FULL_EXPORT_COLLECTIONS: [],
    streamExcelExport: vi.fn(),
    streamSqlExport: vi.fn(),
  };
});

vi.mock('../../server/api/lib/services/financeReportService.js', () => {
  moduleLoads.finance += 1;
  return { aggregateFinanceMonth: vi.fn() };
});

vi.mock('../../server/api/lib/services/dashboardAggregateService.js', () => {
  moduleLoads.dashboard += 1;
  return { aggregateDashboardReadModel: vi.fn() };
});

vi.mock('../../server/api/payments/payos/handlers/reconcile.js', () => {
  moduleLoads.reconcile += 1;
  return { handleReconcile: vi.fn() };
});

vi.mock('../../server/api/lib/jobs/productionHandlers.js', () => {
  moduleLoads.outboxHandlers += 1;
  return { initOutboxHandlers: vi.fn() };
});

describe('audit function cold imports', () => {
  it('does not load action-specific heavy modules while importing the handler', async () => {
    await import('../../server/api/audit/route');

    expect(moduleLoads).toEqual({
      exports: 0,
      finance: 0,
      dashboard: 0,
      reconcile: 0,
      outboxHandlers: 0,
    });
  });
});
