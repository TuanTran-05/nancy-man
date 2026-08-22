import { describe, expect, it, vi } from 'vitest';
import { reserveInvoiceForPayment } from './invoiceService.js';

function makeDoc(data: Record<string, unknown>, options: { id?: string; exists?: boolean } = {}) {
  return {
    id: options.id || 'doc-1',
    exists: options.exists ?? true,
    ref: { id: options.id || 'doc-1' },
    data: () => data,
  };
}

function makeInvoiceDb(existingInvoice?: Record<string, unknown>) {
  const invoiceRef = { id: 'invoice-new' };
  const invoiceQuery: any = {
    where: vi.fn(() => invoiceQuery),
    limit: vi.fn(() => invoiceQuery),
  };
  const tx = {
    get: vi.fn(async (target: any) => {
      if (target === invoiceQuery) {
        return existingInvoice
          ? { empty: false, docs: [makeDoc(existingInvoice, { id: 'invoice-existing' })] }
          : { empty: true, docs: [] };
      }
      return makeDoc({}, { exists: false });
    }),
    create: vi.fn(),
    update: vi.fn(),
  };
  const db = {
    collection: vi.fn((name: string) => {
      expect(name).toBe('invoices');
      return {
        doc: vi.fn(() => invoiceRef),
        where: vi.fn(() => invoiceQuery),
      };
    }),
  };
  return { db, tx, invoiceRef };
}

const baseInput = {
  ledgerId: 'ledger-1',
  studentId: 'student-1',
  classId: 'class-1',
  parentUid: 'parent-1',
  orderCode: 2605210001,
  amountDue: 500000,
  ledger: { amount: 700000, paidTotal: 200000, discountTotal: 0 },
  studentName: 'Student A',
  className: 'Class A',
  now: new Date('2026-05-21T01:00:00.000Z'),
};

describe('invoiceService', () => {
  it('reuses an active invoice when the immutable amount snapshot still matches', async () => {
    const { db, tx } = makeInvoiceDb({
      invoiceNo: 'INV-2605210001',
      amountDue: 500000,
      currency: 'VND',
      status: 'issued',
      snapshotVersion: 1,
    });

    const result = await reserveInvoiceForPayment(tx as any, db as any, baseInput);

    expect(result).toMatchObject({
      created: false,
      invoiceId: 'invoice-existing',
      invoiceNo: 'INV-2605210001',
      amountDue: 500000,
    });
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('supersedes a stale active invoice and creates a new immutable snapshot', async () => {
    const { db, tx, invoiceRef } = makeInvoiceDb({
      invoiceNo: 'INV-old',
      amountDue: 400000,
      currency: 'VND',
      status: 'issued',
      snapshotVersion: 1,
    });

    const result = await reserveInvoiceForPayment(tx as any, db as any, baseInput);

    expect(result).toMatchObject({
      created: true,
      invoiceId: 'invoice-new',
      invoiceNo: 'INV-2605210001',
      amountDue: 500000,
    });
    expect(tx.update).toHaveBeenCalledWith(
      { id: 'invoice-existing' },
      expect.objectContaining({
        status: 'superseded',
        supersededAt: '2026-05-21T01:00:00.000Z',
      })
    );
    expect(tx.create).toHaveBeenCalledWith(
      invoiceRef,
      expect.objectContaining({
        invoiceNo: 'INV-2605210001',
        ledgerId: 'ledger-1',
        studentId: 'student-1',
        classId: 'class-1',
        amountDue: 500000,
        ledgerAmountSnapshot: 700000,
        paidTotalSnapshot: 200000,
        discountTotalSnapshot: 0,
        studentSnapshot: { id: 'student-1', name: 'Student A' },
        classSnapshot: { id: 'class-1', name: 'Class A' },
        status: 'issued',
        snapshotVersion: 1,
      })
    );
  });
});
