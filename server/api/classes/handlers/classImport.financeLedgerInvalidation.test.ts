import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCreate } from './classCrudHandlers.js';
import { handleImportStudents } from './classOperationsHandlers.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  importStudentsFromClass,
  type ClassProgressionSummary,
} from '../helpers/studentImportHelper.js';

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../helpers/studentImportHelper.js', () => ({
  importStudentsFromClass: vi.fn(),
}));

vi.mock('../../lib/maintenance/studentIdentityMaintenance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/maintenance/studentIdentityMaintenance.js')>()),
  assertStudentIdentityMutationAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../helpers/classHelpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/classHelpers.js')>()),
  ensureUniqueClassName: vi.fn().mockResolvedValue(undefined),
  writeClassAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../helpers/courseClosing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/courseClosing.js')>()),
  invalidateCourseClosingApprovals: vi.fn().mockResolvedValue([]),
}));

function responseDouble() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function financeLedgerEventCount() {
  return vi
    .mocked(touchRealtimeEvent)
    .mock.calls.filter(([channel]) => channel === 'finance-ledger').length;
}

function summaryWithLedgers(createdLedgerCount: number): ClassProgressionSummary {
  return {
    eligibleCount: 2,
    progressedCount: 2,
    replayedCount: 0,
    skippedCount: 0,
    failures: [],
    rolloverBalance: 0,
    createdLedgerCount,
    affectedClassIds: ['class-source'],
    importedCount: 2,
    skippedDuplicates: 0,
    linkedExistingCount: 0,
  };
}

const ADMIN = { uid: 'admin-1', email: 'admin@example.com' };
const ADMIN_INFO = { role: 'admin', name: 'Admin' };

describe('class import finance-ledger invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleCreate (create class with imported cohort)', () => {
    function createDb() {
      const healthSet = vi.fn().mockResolvedValue(undefined);
      const db = {
        collection: vi.fn((name: string) => {
          if (name === 'classes') {
            return { add: vi.fn().mockResolvedValue({ id: 'class-new' }) };
          }
          if (name === 'admin_class_tuition_health') {
            return { doc: vi.fn(() => ({ set: healthSet })) };
          }
          throw new Error(`Unexpected collection: ${name}`);
        }),
      };
      return { db, healthSet };
    }

    async function runCreate(createdLedgerCount: number) {
      vi.mocked(importStudentsFromClass).mockResolvedValue(summaryWithLedgers(createdLedgerCount));
      const response = responseDouble();
      const { db, healthSet } = createDb();

      await handleCreate(
        {
          method: 'POST',
          body: {
            name: 'Lop 6A',
            teacherId: 'teacher-1',
            importSourceClassId: 'class-source',
            startDate: '2026-09-01',
            tuitionFee: 1_200_000,
          },
          headers: {},
        } as any,
        response as any,
        db as any,
        ADMIN,
        ADMIN_INFO
      );

      expect(response.status).toHaveBeenCalledWith(201);
      expect(healthSet).toHaveBeenCalledWith(
        expect.objectContaining({
          healthy: false,
          lastDailyRebuildStatus: 'failed',
          invalidationReason: 'class:create',
        }),
        { merge: true }
      );
    }

    it('publishes finance-ledger when the cohort import creates tuition ledgers', async () => {
      await runCreate(2);

      expect(financeLedgerEventCount()).toBe(1);
    });

    it('does not publish finance-ledger when no tuition ledger was created', async () => {
      await runCreate(0);

      expect(financeLedgerEventCount()).toBe(0);
    });
  });

  describe('handleImportStudents (import into an existing class)', () => {
    function importDb() {
      return {
        collection: vi.fn((name: string) => {
          if (name === 'classes') {
            return {
              doc: () => ({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ teacherId: 'teacher-1', grade: 6 }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected collection: ${name}`);
        }),
      };
    }

    async function runImport(createdLedgerCount: number) {
      vi.mocked(importStudentsFromClass).mockResolvedValue(summaryWithLedgers(createdLedgerCount));
      const response = responseDouble();

      await handleImportStudents(
        {
          method: 'POST',
          body: { sourceClassId: 'class-source', targetClassId: 'class-target' },
          headers: {},
        } as any,
        response as any,
        importDb() as any,
        ADMIN,
        ADMIN_INFO
      );

      expect(response.status).toHaveBeenCalledWith(200);
    }

    it('publishes finance-ledger when the import creates tuition ledgers', async () => {
      await runImport(3);

      expect(financeLedgerEventCount()).toBe(1);
    });

    it('does not publish finance-ledger when no tuition ledger was created', async () => {
      await runImport(0);

      expect(financeLedgerEventCount()).toBe(0);
    });
  });
});
