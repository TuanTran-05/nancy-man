import { describe, expect, it } from 'vitest';
import { reconcileStudentFinance } from './financeReconciler.js';

function baseInput(overrides: Partial<Parameters<typeof reconcileStudentFinance>[0]> = {}) {
  return {
    canonicalProfileId: 'canonical-1',
    profiles: [
      {
        id: 'canonical-1',
        walletBalance: 0,
        walletOpeningBalance: 0,
        ledgers: [],
        receipts: [],
        invoices: [],
        pendingPayments: [],
      },
      {
        id: 'legacy-1',
        walletBalance: 0,
        walletOpeningBalance: 0,
        ledgers: [],
        receipts: [],
        invoices: [],
        pendingPayments: [],
      },
    ],
    ...overrides,
  };
}

describe('reconcileStudentFinance — integer money', () => {
  it('rejects a NaN wallet balance instead of silently coercing it', () => {
    const input = baseInput();
    input.profiles[0].walletBalance = Number.NaN;
    expect(() => reconcileStudentFinance(input)).toThrow('STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER');
  });

  it('rejects a fractional ledger amount', () => {
    const input = baseInput();
    input.profiles[0].ledgers.push({
      id: 'l-1',
      classId: 'c-1',
      termStart: '2026-08-01',
      termEnd: '2026-09-20',
      amount: 1200.5,
      paidTotal: 0,
      discountTotal: 0,
      status: 'unpaid',
    });
    expect(() => reconcileStudentFinance(input)).toThrow('STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER');
  });
});

describe('reconcileStudentFinance — conservation', () => {
  it('produces identical before and expectedAfter totals when nothing conflicts', () => {
    const input = baseInput();
    input.profiles[0].walletBalance = 500_000;
    input.profiles[0].ledgers.push({
      id: 'l-1',
      classId: 'c-1',
      termStart: '2026-08-01',
      termEnd: '2026-09-20',
      amount: 1_000_000,
      paidTotal: 500_000,
      discountTotal: 0,
      status: 'partially_paid',
    });
    const { before, expectedAfter, blockers } = reconcileStudentFinance(input);
    expect(blockers).toEqual([]);
    expect(before).toEqual(expectedAfter);
    expect(before.walletBalance).toBe(500_000);
    expect(before.ledgerAmounts).toBe(1_000_000);
    expect(before.paidAmounts).toBe(500_000);
  });

  it('sums totals across all profiles in the group, not just the canonical one', () => {
    const input = baseInput();
    input.profiles[0].ledgers.push({
      id: 'l-canonical', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 500_000, paidTotal: 0, discountTotal: 0, status: 'unpaid',
    });
    input.profiles[1].ledgers.push({
      id: 'l-legacy', classId: 'c-2', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 700_000, paidTotal: 0, discountTotal: 0, status: 'unpaid',
    });
    const { before } = reconcileStudentFinance(input);
    expect(before.ledgerAmounts).toBe(1_200_000);
  });
});

describe('reconcileStudentFinance — keyed ledger ownership', () => {
  it('moves only the keyed ledger and leaves random-id attachments to the registry stage', () => {
    const input = baseInput();
    input.profiles[1].ledgers.push({
      id: 'legacy-1_c-1_2026-08-01_2026-09-20', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 1_000_000, paidTotal: 300_000, discountTotal: 0, status: 'partially_paid',
    });
    input.profiles[1].receipts.push({ id: 'r-1', ledgerId: 'legacy-1_c-1_2026-08-01_2026-09-20', amount: 300_000 });
    input.profiles[1].invoices.push({ id: 'inv-1', ledgerId: 'legacy-1_c-1_2026-08-01_2026-09-20', amount: 1_000_000 });

    const { operations, blockers } = reconcileStudentFinance(input);
    expect(blockers).toEqual([]);

    const ledgerOp = operations.find((op) => op.sourcePath === 'course_fee_ledgers/legacy-1_c-1_2026-08-01_2026-09-20');
    expect(ledgerOp).toBeDefined();
    expect(ledgerOp?.targetPath).toBe('course_fee_ledgers/canonical-1_c-1_2026-08-01_2026-09-20');
    expect(ledgerOp?.registryEntryId).toBe('course_fee_ledgers.keyed');

    const receiptOp = operations.find((op) => op.sourcePath === 'receipts/r-1');
    expect(receiptOp).toBeUndefined();

    const invoiceOp = operations.find((op) => op.sourcePath === 'invoices/inv-1');
    expect(invoiceOp).toBeUndefined();
  });

  it('does not emit copy-to-self operations for canonical receipts or invoices', () => {
    const input = baseInput();
    input.profiles[0].receipts.push({ id: 'r-1', ledgerId: 'ledger-1', amount: 300_000 });
    input.profiles[0].invoices.push({ id: 'inv-1', ledgerId: 'ledger-1', amount: 1_000_000 });

    const result = reconcileStudentFinance(input);

    expect(result.operations).toEqual([]);
    expect(result.before.receiptAmounts).toBe(300_000);
    expect(result.before.invoiceAmounts).toBe(1_000_000);
    expect(result.before).toEqual(result.expectedAfter);
  });

  it('is deterministic under shuffled profile order', () => {
    const input = baseInput();
    input.profiles[1].ledgers.push({
      id: 'l-1', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 900_000, paidTotal: 0, discountTotal: 0, status: 'unpaid',
    });
    const forward = reconcileStudentFinance(input);
    const reversedInput = { ...input, profiles: [...input.profiles].reverse() };
    const backward = reconcileStudentFinance(reversedInput);
    expect(forward.before).toEqual(backward.before);
    expect(forward.operations.map((o) => o.operationId).sort()).toEqual(
      backward.operations.map((o) => o.operationId).sort()
    );
  });
});

describe('reconcileStudentFinance — collision blockers', () => {
  it('blocks when two profiles both hold a non-zero wallet balance', () => {
    const input = baseInput();
    input.profiles[0].walletBalance = 100_000;
    input.profiles[1].walletBalance = 50_000;
    const { blockers } = reconcileStudentFinance(input);
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'WALLET_NONZERO_COLLISION' }));
  });

  it('does not block when only one profile holds a non-zero wallet balance', () => {
    const input = baseInput();
    input.profiles[1].walletBalance = 50_000;
    const { blockers } = reconcileStudentFinance(input);
    expect(blockers).toEqual([]);
  });

  it('blocks two active pending payments for the same class/term obligation', () => {
    const input = baseInput();
    input.profiles[0].pendingPayments.push({ id: 'p-1', ledgerId: 'l-a', classId: 'c-1', termStart: '2026-08-01', amount: 500_000, status: 'pending' });
    input.profiles[1].pendingPayments.push({ id: 'p-2', ledgerId: 'l-b', classId: 'c-1', termStart: '2026-08-01', amount: 500_000, status: 'pending' });
    const { blockers } = reconcileStudentFinance(input);
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'PENDING_PAYMENT_COLLISION' }));
  });

  it('blocks a target-key collision between two non-identical ledgers moving to the same canonical key', () => {
    const input = baseInput();
    input.profiles[0].ledgers.push({
      id: 'canonical-1_c-1_2026-08-01_2026-09-20', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 1_000_000, paidTotal: 0, discountTotal: 0, status: 'unpaid',
    });
    input.profiles[1].ledgers.push({
      id: 'legacy-1_c-1_2026-08-01_2026-09-20', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 900_000, paidTotal: 0, discountTotal: 0, status: 'unpaid',
    });
    const { blockers } = reconcileStudentFinance(input);
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'LEDGER_TARGET_COLLISION' }));
  });

  it('deduplicates a target-key collision between two semantically identical ledgers instead of blocking', () => {
    const input = baseInput();
    input.profiles[0].ledgers.push({
      id: 'canonical-1_c-1_2026-08-01_2026-09-20', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 1_000_000, paidTotal: 200_000, discountTotal: 0, status: 'partially_paid',
    });
    input.profiles[1].ledgers.push({
      id: 'legacy-1_c-1_2026-08-01_2026-09-20', classId: 'c-1', termStart: '2026-08-01', termEnd: '2026-09-20',
      amount: 1_000_000, paidTotal: 200_000, discountTotal: 0, status: 'partially_paid',
    });
    const { blockers, before, expectedAfter } = reconcileStudentFinance(input);
    expect(blockers.filter((b) => b.code === 'LEDGER_TARGET_COLLISION')).toEqual([]);
    // Deduplicated: counted once, not twice.
    expect(before.ledgerAmounts).toBe(1_000_000);
    expect(expectedAfter.ledgerAmounts).toBe(1_000_000);
  });
});
