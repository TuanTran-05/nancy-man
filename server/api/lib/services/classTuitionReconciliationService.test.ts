import { describe, expect, it, vi } from 'vitest';
import {
  buildClassReconciliationOptions,
  buildClassTuitionReconciliationReport,
  buildClassTuitionStudentDetail,
  ClassReconciliationNotFoundError,
  ClassReconciliationInvalidInputError,
} from './classTuitionReconciliationService.js';
import { ClassTuitionReconciliationRepository } from '../repositories/classTuitionReconciliationRepository.js';

describe('classTuitionReconciliationService', () => {
  describe('buildClassReconciliationOptions', () => {
    it('returns classes mode when classId is not provided, sorted by status -> name -> id', async () => {
      const mockClasses = [
        { id: 'c-archived', name: 'B Class', status: 'archived' as const, teacherId: 't2', teacherName: 'Tran Thi B', terms: [] },
        { id: 'c-active-2', name: 'B Class', status: 'active' as const, teacherId: 't1', teacherName: 'Nguyen Van A', terms: [] },
        { id: 'c-active-1', name: 'A Class', status: 'active' as const, teacherId: '', teacherName: '', terms: [] },
        { id: 'c-paused', name: 'C Class', status: 'paused' as const, teacherId: 't3', teacherName: '', terms: [] },
      ];

      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listClasses').mockResolvedValue(mockClasses);

      const res = await buildClassReconciliationOptions({} as any, {});
      expect(res.mode).toBe('classes');
      if (res.mode === 'classes') {
        expect(res.classes.map((c) => c.id)).toEqual([
          'c-active-1', // active, A
          'c-active-2', // active, B
          'c-paused',   // paused, C
          'c-archived', // archived, B
        ]);
        // The picker labels each option with its teacher, so both fields must survive.
        expect(res.classes.map((c) => [c.teacherId, c.teacherName])).toEqual([
          ['', ''],
          ['t1', 'Nguyen Van A'],
          ['t3', ''],
          ['t2', 'Tran Thi B'],
        ]);
      }
    });

    it('returns courses mode with resolved fee options when classId is provided', async () => {
      const classSource = {
        id: 'c1',
        name: 'Class 1',
        status: 'active' as const,
        teacherId: 't1',
        teacherName: 'Nguyen Van A',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        tuitionFee: 2_000_000,
        terms: [
          {
            id: 't1',
            name: 'Term 1',
            startDate: '2026-01-01',
            endDate: '2026-05-31',
            tuitionFee: 1_800_000,
          },
        ],
      };

      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'getClass').mockResolvedValue(classSource);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listEnrollmentsByClass').mockResolvedValue([]);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listLedgersByClass').mockResolvedValue([]);

      const res = await buildClassReconciliationOptions({} as any, { classId: 'c1' });
      expect(res.mode).toBe('courses');
      if (res.mode === 'courses') {
        expect(res.selectedClass.id).toBe('c1');
        expect(res.selectedClass.teacherId).toBe('t1');
        expect(res.selectedClass.teacherName).toBe('Nguyen Van A');
        expect(res.courses).toHaveLength(2);
        expect(res.courses[0]).toMatchObject({
          termStart: '2026-06-01',
          isCurrent: true,
          tuitionFee: 2_000_000,
          tuitionFeeSource: 'class_current',
        });
        expect(res.courses[1]).toMatchObject({
          termStart: '2026-01-01',
          isCurrent: false,
          tuitionFee: 1_800_000,
          tuitionFeeSource: 'term_snapshot',
        });
        // sourceKinds should not be exposed
        expect((res.courses[0] as any).sourceKinds).toBeUndefined();
      }
    });

    it('throws ClassReconciliationNotFoundError if class does not exist', async () => {
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'getClass').mockResolvedValue(null);
      await expect(buildClassReconciliationOptions({} as any, { classId: 'c-missing' })).rejects.toThrow(
        ClassReconciliationNotFoundError
      );
    });
  });

  describe('buildClassTuitionReconciliationReport', () => {
    it('validates input and throws ClassReconciliationInvalidInputError on bad termStart', async () => {
      await expect(
        buildClassTuitionReconciliationReport({} as any, { classId: 'c1', termStart: 'invalid-date' })
      ).rejects.toThrow(ClassReconciliationInvalidInputError);
    });

    it('throws ClassReconciliationNotFoundError if termStart does not match any course for class', async () => {
      const classSource = {
        id: 'c1',
        name: 'Class 1',
        status: 'active' as const,
        teacherId: 't1',
        teacherName: 'Nguyen Van A',
        startDate: '2026-06-01',
        terms: [],
      };
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'getClass').mockResolvedValue(classSource);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listEnrollmentsByCourse').mockResolvedValue([]);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listLedgersByCourse').mockResolvedValue([]);

      await expect(
        buildClassTuitionReconciliationReport({} as any, { classId: 'c1', termStart: '2025-01-01' })
      ).rejects.toThrow(ClassReconciliationNotFoundError);
    });

    it('builds full reconciliation report for matching course scope and only fetches union students', async () => {
      const classSource = {
        id: 'c1',
        name: 'Class 1',
        status: 'active' as const,
        teacherId: 't1',
        teacherName: 'Nguyen Van A',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        tuitionFee: 2_000_000,
        terms: [],
      };

      const enrollments = [
        { id: 'e1', studentId: 'st1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
      ];
      const ledgers = [
        { id: 'l1', studentId: 'st1', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 0, paidTotal: 2_000_000 },
      ];
      const students = [
        { id: 'st1', fullName: 'Nguyen Van A', studentCode: 'HV001' },
      ];

      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'getClass').mockResolvedValue(classSource);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listEnrollmentsByCourse').mockResolvedValue(enrollments);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listLedgersByCourse').mockResolvedValue(ledgers);
      const studentSpy = vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listStudentsByIds').mockResolvedValue(students);

      const report = await buildClassTuitionReconciliationReport({} as any, {
        classId: 'c1',
        termStart: '2026-06-01',
      });

      expect(studentSpy).toHaveBeenCalledWith(['st1']);
      expect(report.success).toBe(true);
      expect(report.scope).toEqual({
        classId: 'c1',
        className: 'Class 1',
        courseId: null,
        termStart: '2026-06-01',
        termEnd: '2026-08-31',
        courseLabel: '2026-06-01',
      });
      expect(report.tuitionFee).toEqual({
        amount: 2_000_000,
        source: 'class_current',
      });
      expect(report.summary.expectedGross).toBe(2_000_000);
      expect(report.summary.paidTotal).toBe(2_000_000);
      expect(report.rows).toHaveLength(1);
    });
  });

  describe('buildClassTuitionStudentDetail', () => {
    it('validates XOR of studentId and ledgerId and rejects if neither or both are given', async () => {
      await expect(
        buildClassTuitionStudentDetail({} as any, { classId: 'c1', termStart: '2026-06-01' })
      ).rejects.toThrow(ClassReconciliationInvalidInputError);

      await expect(
        buildClassTuitionStudentDetail({} as any, {
          classId: 'c1',
          termStart: '2026-06-01',
          studentId: 'st1',
          ledgerId: 'l1',
        })
      ).rejects.toThrow(ClassReconciliationInvalidInputError);
    });

    it('builds student detail with allocations from v2 receipts and workspace link', async () => {
      const enrollments = [
        { id: 'e1', studentId: 'st1', classId: 'c1', termStart: '2026-06-01', status: 'active', joinedAt: '2026-06-01', endedAt: null },
      ];
      const ledgers = [
        { id: 'l1', studentId: 'st1', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 200_000, paidTotal: 1_800_000 },
      ];
      const students = [
        { id: 'st1', fullName: 'Nguyen Van A', studentCode: 'HV001' },
      ];
      const receipts = [
        {
          id: 'r1',
          receiptNo: 'PT001',
          receivedDate: '2026-06-05',
          paymentMethod: 'bank_transfer',
          status: 'posted',
          note: 'Thu hoc phi',
          allocations: [
            { ledgerId: 'l1', classId: 'c1', amount: 1_800_000, discountAmount: 200_000, discountType: 'voucher' },
            { ledgerId: 'l-other', classId: 'c-other', amount: 500_000 },
          ],
        },
      ];

      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listEnrollmentsByCourse').mockResolvedValue(enrollments);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listLedgersByCourse').mockResolvedValue(ledgers);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listStudentsByIds').mockResolvedValue(students);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listPostedReceiptsByStudent').mockResolvedValue(receipts);

      const detail = await buildClassTuitionStudentDetail({} as any, {
        classId: 'c1',
        termStart: '2026-06-01',
        studentId: 'st1',
      });

      expect(detail.success).toBe(true);
      expect(detail.student).toEqual({
        id: 'st1',
        fullName: 'Nguyen Van A',
        studentCode: 'HV001',
        recordFound: true,
      });
      expect(detail.enrollments).toHaveLength(1);
      expect(detail.ledgers).toHaveLength(1);
      expect(detail.ledgers[0]).toEqual({
        id: 'l1',
        gross: 2_000_000,
        reduction: 200_000,
        netDue: 1_800_000,
        paid: 1_800_000,
        outstanding: 0,
        overpaid: 0,
      });
      expect(detail.allocations).toHaveLength(1);
      expect(detail.allocations[0]).toEqual({
        receiptId: 'r1',
        receiptNo: 'PT001',
        receivedDate: '2026-06-05',
        paymentMethod: 'bank_transfer',
        allocatedAmount: 1_800_000,
        discountAmount: 200_000,
        discountType: 'voucher',
        note: 'Thu hoc phi',
      });
      expect(detail.workspaceUrl).toBe(
        '/tuition?tab=students&studentLifecycleScope=all&studentClassId=c1&studentExpandedId=st1'
      );
    });

    it('builds orphan ledger detail without student record and with workspaceUrl null', async () => {
      const ledger = {
        id: 'l-orphan',
        studentId: null,
        classId: 'c1',
        termStart: '2026-06-01',
        amount: 1_000_000,
        discountTotal: 0,
        paidTotal: 1_000_000,
      };
      const receipts = [
        {
          id: 'r-orphan',
          receiptNo: 'PT-ORPHAN',
          receivedDate: '2026-06-10',
          paymentMethod: 'cash',
          status: 'posted',
          ledgerId: 'l-orphan',
          amountReceived: 1_000_000,
          discountAmount: 0,
          note: 'Thu orphan',
        },
      ];

      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'getLedger').mockResolvedValue(ledger);
      vi.spyOn(ClassTuitionReconciliationRepository.prototype, 'listPostedReceiptsByClass').mockResolvedValue(receipts);

      const detail = await buildClassTuitionStudentDetail({} as any, {
        classId: 'c1',
        termStart: '2026-06-01',
        ledgerId: 'l-orphan',
      });

      expect(detail.student).toEqual({
        id: null,
        fullName: '',
        studentCode: '',
        recordFound: false,
      });
      expect(detail.enrollments).toHaveLength(0);
      expect(detail.ledgers).toHaveLength(1);
      expect(detail.allocations).toHaveLength(1);
      expect(detail.allocations[0].receiptId).toBe('r-orphan');
      expect(detail.workspaceUrl).toBeNull();
      expect(detail.warnings).toContain('ledger_student_missing');
    });
  });
});
