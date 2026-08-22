import { buildCourseLedgerId } from '../../server/api/lib/accounting/courseLedgerIdentity.js';
import { assertSafeIntegerMoney, sha256 } from './canonicalJson.js';
import type { StudentMergeBlocker } from './types.js';

/**
 * Financial reconciliation for one identity group.
 *
 * Money is the part of this migration that cannot be re-derived if it goes
 * wrong, so three rules are enforced structurally rather than by convention.
 *
 * 1. Every monetary value is a safe integer. A NaN or fractional amount throws
 *    rather than producing a plan, because a coerced value would silently
 *    corrupt the conservation check that is supposed to catch corruption.
 *
 * 2. Ownership may move; totals may not. `before` and `expectedAfter` are
 *    computed by two different routes — one over the current source documents,
 *    one over the planned target documents — so their equality is a real check
 *    rather than a restatement. A divergence means the plan itself is wrong.
 *
 * 3. This reconciler owns keyed ledger moves and money conservation. Receipt
 *    and invoice ownership fields are rewritten by the reference-registry
 *    stage, which runs after every ledger move. They are not documents to
 *    recreate: their random document ids stay unchanged.
 */

export type FinanceLedger = {
  id: string;
  classId: string;
  termStart: string;
  termEnd: string;
  amount: number;
  paidTotal: number;
  discountTotal: number;
  status: string;
};

export type FinanceReceipt = { id: string; ledgerId: string; amount: number };
export type FinanceInvoice = { id: string; ledgerId: string; amount: number };
export type FinancePendingPayment = {
  id: string;
  ledgerId: string;
  classId: string;
  termStart: string;
  amount: number;
  status: string;
};

export type FinanceProfileSource = {
  id: string;
  walletBalance: number;
  walletOpeningBalance: number;
  ledgers: FinanceLedger[];
  receipts: FinanceReceipt[];
  invoices: FinanceInvoice[];
  pendingPayments: FinancePendingPayment[];
};

export type FinanceTotals = {
  walletBalance: number;
  walletOpeningBalance: number;
  ledgerAmounts: number;
  paidAmounts: number;
  discountAmounts: number;
  receiptAmounts: number;
  invoiceAmounts: number;
  pendingPaymentAmounts: number;
};

export type FinanceMoveOperation = {
  operationId: string;
  stage: 'move_finance_keys';
  registryEntryId: string;
  sourceProfileId: string;
  canonicalProfileId: string;
  sourcePath: string;
  targetPath: string;
  dependsOn: string[];
  containsMoney: true;
};

export type FinanceReconciliationInput = {
  canonicalProfileId: string;
  profiles: FinanceProfileSource[];
};

/** A pending payment is only a live obligation in these states. */
const ACTIVE_PENDING_STATUSES = new Set(['pending', 'processing', 'awaiting_confirmation']);

function operationIdFor(sourcePath: string, targetPath: string): string {
  // Content-derived so the same plan produces the same ids no matter what
  // order the source profiles arrived in.
  return sha256(`move_finance_keys|${sourcePath}|${targetPath}`).slice(0, 32);
}

function assertProfileMoney(profile: FinanceProfileSource): void {
  assertSafeIntegerMoney(profile.walletBalance, `${profile.id}.walletBalance`);
  assertSafeIntegerMoney(profile.walletOpeningBalance, `${profile.id}.walletOpeningBalance`);
  for (const ledger of profile.ledgers) {
    assertSafeIntegerMoney(ledger.amount, `${ledger.id}.amount`);
    assertSafeIntegerMoney(ledger.paidTotal, `${ledger.id}.paidTotal`);
    assertSafeIntegerMoney(ledger.discountTotal, `${ledger.id}.discountTotal`);
  }
  for (const receipt of profile.receipts) {
    assertSafeIntegerMoney(receipt.amount, `${receipt.id}.amount`);
  }
  for (const invoice of profile.invoices) {
    assertSafeIntegerMoney(invoice.amount, `${invoice.id}.amount`);
  }
  for (const payment of profile.pendingPayments) {
    assertSafeIntegerMoney(payment.amount, `${payment.id}.amount`);
  }
}

/**
 * Two ledgers are the same obligation when every business and monetary field
 * matches. Deliberately compares all of them rather than a convenient subset:
 * a comparator that ignored `status` or `discountTotal` would silently merge
 * two ledgers that owe different things.
 */
function isSameObligation(left: FinanceLedger, right: FinanceLedger): boolean {
  return (
    left.classId === right.classId &&
    left.termStart === right.termStart &&
    left.termEnd === right.termEnd &&
    left.amount === right.amount &&
    left.paidTotal === right.paidTotal &&
    left.discountTotal === right.discountTotal &&
    left.status === right.status
  );
}

function emptyTotals(): FinanceTotals {
  return {
    walletBalance: 0,
    walletOpeningBalance: 0,
    ledgerAmounts: 0,
    paidAmounts: 0,
    discountAmounts: 0,
    receiptAmounts: 0,
    invoiceAmounts: 0,
    pendingPaymentAmounts: 0,
  };
}

export function reconcileStudentFinance(input: FinanceReconciliationInput): {
  before: FinanceTotals;
  expectedAfter: FinanceTotals;
  operations: FinanceMoveOperation[];
  blockers: StudentMergeBlocker[];
} {
  const blockers: StudentMergeBlocker[] = [];
  const canonicalId = input.canonicalProfileId;

  // Sort so every downstream grouping, id, and total is order-independent.
  const profiles = [...input.profiles].sort((a, b) => a.id.localeCompare(b.id));
  for (const profile of profiles) {
    assertProfileMoney(profile);
  }

  // --- Wallet: at most one non-zero balance may exist in a group ---
  const nonZeroWallets = profiles.filter((p) => p.walletBalance !== 0);
  if (nonZeroWallets.length > 1) {
    blockers.push({
      code: 'WALLET_NONZERO_COLLISION',
      candidateId: canonicalId,
      detail: `non-zero wallet balances on ${nonZeroWallets.map((p) => p.id).join(', ')}`,
    });
  }

  // --- Ledgers: group by the key they will occupy after the move ---
  type LedgerEntry = { profileId: string; ledger: FinanceLedger };
  const byTargetKey = new Map<string, LedgerEntry[]>();
  for (const profile of profiles) {
    const ordered = [...profile.ledgers].sort((a, b) => a.id.localeCompare(b.id));
    for (const ledger of ordered) {
      const targetId = buildCourseLedgerId(canonicalId, ledger.classId, ledger.termStart, ledger.termEnd);
      const bucket = byTargetKey.get(targetId);
      if (bucket) bucket.push({ profileId: profile.id, ledger });
      else byTargetKey.set(targetId, [{ profileId: profile.id, ledger }]);
    }
  }

  const before = emptyTotals();
  const expectedAfter = emptyTotals();
  const operations: FinanceMoveOperation[] = [];
  const survivingLedgerIds = new Set<string>();

  for (const targetId of [...byTargetKey.keys()].sort()) {
    const entries = byTargetKey.get(targetId)!;
    const collides = entries.length > 1;
    const identical = collides && entries.every((entry) => isSameObligation(entry.ledger, entries[0].ledger));

    if (collides && !identical) {
      blockers.push({
        code: 'LEDGER_TARGET_COLLISION',
        candidateId: canonicalId,
        detail: `ledgers ${entries.map((e) => e.ledger.id).join(', ')} target ${targetId} with differing values`,
      });
      // Count every document. A blocked plan must not appear to have lost
      // money — that would hide the collision behind a clean-looking total.
      for (const entry of entries) {
        before.ledgerAmounts += entry.ledger.amount;
        before.paidAmounts += entry.ledger.paidTotal;
        before.discountAmounts += entry.ledger.discountTotal;
        expectedAfter.ledgerAmounts += entry.ledger.amount;
        expectedAfter.paidAmounts += entry.ledger.paidTotal;
        expectedAfter.discountAmounts += entry.ledger.discountTotal;
        survivingLedgerIds.add(entry.ledger.id);
      }
      continue;
    }

    // One obligation, counted once. When the clone bug produced the same
    // ledger under two profile ids, both documents describe a single debt;
    // counting each would inflate the total and make conservation
    // unachievable once the merge collapses them.
    const representative = entries[0].ledger;
    before.ledgerAmounts += representative.amount;
    before.paidAmounts += representative.paidTotal;
    before.discountAmounts += representative.discountTotal;
    expectedAfter.ledgerAmounts += representative.amount;
    expectedAfter.paidAmounts += representative.paidTotal;
    expectedAfter.discountAmounts += representative.discountTotal;

    for (const entry of entries) {
      survivingLedgerIds.add(entry.ledger.id);
      if (entry.ledger.id === targetId) continue; // already at its canonical key
      const sourcePath = `course_fee_ledgers/${entry.ledger.id}`;
      const targetPath = `course_fee_ledgers/${targetId}`;
      const operationId = operationIdFor(sourcePath, targetPath);
      operations.push({
        operationId,
        stage: 'move_finance_keys',
        registryEntryId: 'course_fee_ledgers.keyed',
        sourceProfileId: entry.profileId,
        canonicalProfileId: canonicalId,
        sourcePath,
        targetPath,
        dependsOn: [],
        containsMoney: true,
      });
    }
  }

  // --- Wallet and attachment totals ---
  for (const profile of profiles) {
    before.walletBalance += profile.walletBalance;
    before.walletOpeningBalance += profile.walletOpeningBalance;
    expectedAfter.walletBalance += profile.walletBalance;
    expectedAfter.walletOpeningBalance += profile.walletOpeningBalance;
  }

  // --- Receipt and invoice totals ---
  // Their ids are random and therefore never move. Ownership fields and
  // ledgerId references are handled by the registry-driven rewrite stage
  // after all keyed ledger moves; emitting source===target copy operations
  // here would make the writer copy a document and then delete itself.
  for (const profile of profiles) {
    for (const receipt of [...profile.receipts].sort((a, b) => a.id.localeCompare(b.id))) {
      before.receiptAmounts += receipt.amount;
      expectedAfter.receiptAmounts += receipt.amount;
    }
    for (const invoice of [...profile.invoices].sort((a, b) => a.id.localeCompare(b.id))) {
      before.invoiceAmounts += invoice.amount;
      expectedAfter.invoiceAmounts += invoice.amount;
    }
  }

  // --- Pending payments: one live obligation per class/term ---
  const pendingByObligation = new Map<string, Array<{ profileId: string; payment: FinancePendingPayment }>>();
  for (const profile of profiles) {
    for (const payment of [...profile.pendingPayments].sort((a, b) => a.id.localeCompare(b.id))) {
      before.pendingPaymentAmounts += payment.amount;
      expectedAfter.pendingPaymentAmounts += payment.amount;
      if (!ACTIVE_PENDING_STATUSES.has(payment.status)) continue;
      const key = `${payment.classId}|${payment.termStart}`;
      const bucket = pendingByObligation.get(key);
      if (bucket) bucket.push({ profileId: profile.id, payment });
      else pendingByObligation.set(key, [{ profileId: profile.id, payment }]);
    }
  }
  for (const key of [...pendingByObligation.keys()].sort()) {
    const entries = pendingByObligation.get(key)!;
    if (entries.length > 1) {
      blockers.push({
        code: 'PENDING_PAYMENT_COLLISION',
        candidateId: canonicalId,
        detail: `active payments ${entries.map((e) => e.payment.id).join(', ')} target obligation ${key}`,
      });
    }
  }

  // A ledger that vanished between the two totals would mean the plan itself
  // loses money. Fail loudly rather than emit a plan a reviewer would approve.
  if (survivingLedgerIds.size > 0 && before.ledgerAmounts !== expectedAfter.ledgerAmounts) {
    throw new Error('STUDENT_MERGE_MONEY_CONSERVATION_BROKEN:ledgerAmounts');
  }

  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return { before, expectedAfter, operations, blockers };
}
