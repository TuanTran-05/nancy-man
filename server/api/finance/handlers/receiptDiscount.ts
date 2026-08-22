import { finiteMoney, ledgerRemaining } from './shared.js';
import {
  computeSiblingGrant,
  isSiblingScholarshipEligible,
} from '../../../../shared/siblingScholarship.js';

export function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export type ReceiptDiscountInput = {
  ledger: AppDocumentStore.DocumentData;
  body: Record<string, unknown>;
  discountType: string;
  amountReceived: number;
  /** The server's verdict. Never the client's claim. */
  siblingEligible: boolean;
  /** What the client claimed — used only to detect disagreement. */
  siblingClaimed: boolean;
  siblingWaived: boolean;
  siblingWaivedReason: string;
};

export type ReceiptDiscountResult = {
  receiptDiscount: number;
  siblingGrant: number;
  discountFields: Record<string, unknown>;
};

/**
 * Validates and computes the discount portion of a tuition receipt.
 * Shared by the `create` and `create-and-post` paths so the money rule exists once.
 * Throws a 400-tagged Error on any invalid combination.
 *
 * The client sends only the base discount. Only the server can read
 * `ledger.siblingDiscountTotal`, so only the server sizes the sibling grant.
 */
export function computeReceiptDiscount(input: ReceiptDiscountInput): ReceiptDiscountResult {
  const {
    ledger,
    body,
    discountType,
    amountReceived,
    siblingEligible,
    siblingClaimed,
    siblingWaived,
    siblingWaivedReason,
  } = input;

  const isFullWaiver = discountType === 'full_waiver';
  const waivedReason = String(siblingWaivedReason || '').trim();

  if (!isFullWaiver) {
    if (siblingClaimed && !siblingEligible) {
      throw badRequest('Student is not eligible for the sibling scholarship');
    }
    if (siblingWaived && !waivedReason) {
      throw badRequest('A reason is required to waive the sibling scholarship');
    }
  }

  const siblingGrant = computeSiblingGrant({
    ledgerAmount: finiteMoney(ledger.amount),
    siblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal),
    eligible: siblingEligible,
    waived: siblingWaived,
    isFullWaiver,
  });
  if (siblingClaimed && siblingEligible && !siblingWaived && !isFullWaiver && siblingGrant === 0) {
    throw Object.assign(
      new Error('Sibling scholarship entitlement was already granted; refresh the ledger'),
      { statusCode: 409, errorCode: 'stale_sibling_entitlement' }
    );
  }
  const siblingWaiverRecorded = siblingEligible && siblingWaived && !isFullWaiver;

  const remainingBeforeReceipt = ledgerRemaining(ledger);
  const baseDiscount = discountType === 'none' ? 0 : finiteMoney(body.discountAmount);
  let receiptDiscount = baseDiscount + siblingGrant;

  if (isFullWaiver) {
    if (amountReceived !== 0) throw badRequest('Full waiver cannot include a received amount');
    if (remainingBeforeReceipt <= 0) throw badRequest('No remaining tuition to waive');
    receiptDiscount = remainingBeforeReceipt;
  } else if (amountReceived <= 0) {
    throw badRequest('Amount must be greater than zero');
  } else if (receiptDiscount < 0 || receiptDiscount > remainingBeforeReceipt) {
    throw badRequest('Invalid discount amount');
  }

  if (amountReceived > Math.max(0, remainingBeforeReceipt - receiptDiscount)) {
    throw badRequest('Amount exceeds remaining tuition');
  }

  const bodyDiscountPercent = finiteMoney(body.discountPercent);
  const bodyOriginalAmount = finiteMoney(body.originalAmount);

  const discountFields: Record<string, unknown> = {
    ...(discountType !== 'none' ? { discountType } : {}),
    ...(siblingGrant > 0 ? { siblingDiscount: true, siblingDiscountAmount: siblingGrant } : {}),
    ...(siblingWaiverRecorded
      ? { siblingDiscountWaived: true, siblingDiscountWaivedReason: waivedReason }
      : {}),
    ...(isFullWaiver
      ? { discountPercent: 100 }
      : bodyDiscountPercent > 0
        ? { discountPercent: bodyDiscountPercent }
        : {}),
    ...(receiptDiscount > 0 ? { discountAmount: receiptDiscount } : {}),
    originalAmount: bodyOriginalAmount > 0 ? bodyOriginalAmount : finiteMoney(ledger.amount),
    ...(body.discountReason ? { discountReason: String(body.discountReason) } : {}),
  };

  return { receiptDiscount, siblingGrant, discountFields };
}

/**
 * Reads the student and their sibling group inside the caller's transaction.
 * Must run before any write in that transaction — DocumentStore requires all reads first.
 */
export async function loadSiblingEligibility(
  tx: AppDocumentStore.Transaction,
  db: AppDocumentStore.DocumentStore,
  studentId: string
): Promise<boolean> {
  const studentSnap = await tx.get(db.collection('students').doc(studentId));
  if (!studentSnap.exists) return false;

  const student: Record<string, unknown> = { id: studentSnap.id, ...(studentSnap.data() || {}) };
  const groupId = String(student.siblingGroupId || '').trim();
  if (!groupId) return false;

  const groupSnap = await tx.get(db.collection('students').where('siblingGroupId', '==', groupId));
  return isSiblingScholarshipEligible(
    student,
    groupSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  );
}

/**
 * Re-checks a draft receipt's sibling component against the ledger's remaining
 * entitlement at post time. A draft created before a sibling's receipt posted
 * is clamped down rather than rejected — the accountant should not have to redo
 * it. The base discount is preserved.
 */
export function clampSiblingGrantForPost(args: {
  eligible?: boolean;
  ledgerAmount: number;
  siblingDiscountTotal: number;
  receiptDiscountAmount: number;
  receiptSiblingAmount: number;
}): { siblingGrant: number; discountAmount: number; clamped: boolean } {
  const requested = Math.max(0, finiteMoney(args.receiptSiblingAmount));
  if (requested <= 0) {
    return {
      siblingGrant: 0,
      discountAmount: finiteMoney(args.receiptDiscountAmount),
      clamped: false,
    };
  }

  const available = computeSiblingGrant({
    ledgerAmount: args.ledgerAmount,
    siblingDiscountTotal: args.siblingDiscountTotal,
    eligible: args.eligible !== false,
    waived: false,
    isFullWaiver: false,
  });
  const siblingGrant = Math.min(requested, available);

  return {
    siblingGrant,
    discountAmount: finiteMoney(args.receiptDiscountAmount) - (requested - siblingGrant),
    clamped: siblingGrant !== requested,
  };
}
