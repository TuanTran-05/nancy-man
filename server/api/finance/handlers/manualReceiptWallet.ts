import { FieldValue } from '@/server/db/documentStore.js';
import {
  planManualReceiptVoid,
  planWalletAllocations,
} from '../../../../shared/walletAllocation.js';
import { finiteMoney, resolveLedgerStatus } from '../../../../shared/money.js';
import type { CreateWalletManualReceiptInput } from '../../lib/validation/validations.js';
import { reserveNextCounterSequence } from '../../lib/documentStore/counterSequence.js';
import { getDailyPrefix } from './shared.js';
import { computeReceiptDiscount, loadSiblingEligibility } from './receiptDiscount.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

type Actor = { role: string; name: string };
type ReceiptAllocationSnapshot = {
  ledgerId: string;
  classId: string;
  amount: number;
  discountAmount?: number;
  siblingDiscountAmount?: number;
  [key: string]: unknown;
};

const POST_OPERATION = 'wallet-manual-receipt-post';
const VOID_OPERATION = 'wallet-manual-receipt-void';

function financeError(statusCode: number, errorCode: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, errorCode });
}

function requestFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function assertActorAllowed(userInfo: Actor) {
  if (userInfo.role !== 'admin' && userInfo.role !== 'accounting') {
    throw financeError(
      403,
      'wallet_manual_receipt_forbidden',
      'Only admin or accounting users can create wallet manual receipts'
    );
  }
}

function assertIdempotencyReplay(
  stored: AppDocumentStore.DocumentData,
  operation: string,
  fingerprint: string
) {
  if (stored.type !== operation || stored.requestFingerprint !== fingerprint) {
    throw financeError(
      409,
      'idempotency_key_conflict',
      'Idempotency key was already used for another finance operation'
    );
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function postWalletManualReceipt(input: {
  db: AppDocumentStore.DocumentStore;
  data: CreateWalletManualReceiptInput;
  uid: string;
  userInfo: Actor;
}): Promise<{
  replay: boolean;
  response: {
    success: true;
    id: string;
    receiptNo: string;
    transactionGroupId: string;
    newBalance: number;
  };
  receipt: Record<string, unknown> | null;
  ledgerIds: string[];
}> {
  const { db, data, uid, userInfo } = input;
  assertActorAllowed(userInfo);

  const fingerprint = requestFingerprint(data);
  const idempotencyRef = db
    .collection('finance_idempotency_keys')
    .doc(`${uid}:${data.idempotencyKey}`);
  const studentRef = db.collection('students').doc(data.studentId);
  const receiptRef = db.collection('receipts').doc();
  const uniqueLedgerIds = [...new Set(data.allocations.map((allocation) => allocation.ledgerId))];
  if (uniqueLedgerIds.length !== data.allocations.length) {
    throw financeError(400, 'wallet_duplicate_ledger', 'Duplicate ledger allocation');
  }
  const ledgerRefs = uniqueLedgerIds.map((ledgerId) =>
    db.collection('course_fee_ledgers').doc(ledgerId)
  );
  const { dateStr, prefix } = getDailyPrefix('receipt');

  return runStudentIdentityMutationTransaction(
    db,
    { actorId: uid, operation: 'finance:receipts:create-and-post' },
    async (tx) => {
    const idempotencySnap = await tx.get(idempotencyRef);
    if (idempotencySnap.exists) {
      const stored = idempotencySnap.data() || {};
      assertIdempotencyReplay(stored, POST_OPERATION, fingerprint);
      return {
        replay: true,
        response: stored.response,
        receipt: null,
        ledgerIds: Array.isArray(stored.ledgerIds) ? stored.ledgerIds : [],
      };
    }

    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists) {
      throw financeError(400, 'wallet_student_not_found', 'Student not found');
    }
    const student = studentSnap.data() || {};

    const ledgerSnaps = await Promise.all(ledgerRefs.map((ledgerRef) => tx.get(ledgerRef)));
    const ledgerById = new Map<string, AppDocumentStore.DocumentData>();
    ledgerSnaps.forEach((ledgerSnap, index) => {
      if (!ledgerSnap.exists) {
        throw financeError(400, 'wallet_ledger_not_found', `Ledger not found: ${uniqueLedgerIds[index]}`);
      }
      ledgerById.set(uniqueLedgerIds[index], ledgerSnap.data() || {});
    });

    const siblingEligible = await loadSiblingEligibility(tx, db, data.studentId);
    const activeStatuses = ['creating_gateway_session', 'pending'] as const;
    const activePaymentSnaps = await Promise.all(
      chunks(uniqueLedgerIds, 30).flatMap((ledgerIds) =>
        activeStatuses.map((status) =>
          tx.get(
            db
              .collection('payment_requests')
              .where('ledgerId', 'in', ledgerIds)
              .where('status', '==', status)
          )
        )
      )
    );

    const discountPlans = data.allocations.map((allocation) => {
      const ledger = ledgerById.get(allocation.ledgerId)!;
      if (String(ledger.studentId || '') !== data.studentId) {
        throw financeError(
          400,
          'wallet_ledger_wrong_student',
          `Ledger ${allocation.ledgerId} does not belong to the selected student`
        );
      }
      const discountType = allocation.discountType || 'none';
      let result;
      try {
        result = computeReceiptDiscount({
          ledger,
          body: allocation as unknown as Record<string, unknown>,
          discountType,
          amountReceived: finiteMoney(allocation.amount),
          siblingEligible,
          siblingClaimed: Boolean(allocation.siblingDiscount),
          siblingWaived: Boolean(allocation.siblingDiscountWaived),
          siblingWaivedReason: String(allocation.siblingDiscountWaivedReason || ''),
        });
      } catch (error) {
        if ((error as { errorCode?: string }).errorCode) throw error;
        const message = error instanceof Error ? error.message : 'Invalid receipt allocation';
        throw financeError(
          Number((error as { statusCode?: number }).statusCode || 400),
          /exceeds remaining tuition/i.test(message)
            ? 'wallet_allocation_exceeds_debt'
            : 'wallet_invalid_receipt_allocation',
          message
        );
      }
      return { allocation, ledger, discountType, ...result };
    });

    const effectiveLedgers = discountPlans.map(({ allocation, ledger, receiptDiscount }) => ({
      id: allocation.ledgerId,
      studentId: String(ledger.studentId || ''),
      classId: String(ledger.classId || ''),
      amount: finiteMoney(ledger.amount),
      paidTotal: finiteMoney(ledger.paidTotal),
      discountTotal: finiteMoney(ledger.discountTotal) + receiptDiscount,
      siblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal),
    }));
    const cashAllocations = data.allocations.filter(
      (allocation) => finiteMoney(allocation.amount) > 0
    );
    const walletBalanceBefore = finiteMoney(student.walletBalance);
    const cashPlan = planWalletAllocations({
      studentId: data.studentId,
      walletBalance: walletBalanceBefore,
      depositAmount: finiteMoney(data.amountReceived),
      allocations: cashAllocations,
      ledgers: effectiveLedgers,
    });
    const cashLineByLedger = new Map(cashPlan.lines.map((line) => [line.ledgerId, line]));

    const receiptAllocations: ReceiptAllocationSnapshot[] = discountPlans.map(
      ({
        allocation,
        ledger,
        discountType,
        receiptDiscount,
        siblingGrant,
        discountFields,
      }) => {
        const cashLine = cashLineByLedger.get(allocation.ledgerId);
        const isFullWaiver = discountType === 'full_waiver';
        const newPaidTotal = cashLine?.newPaidTotal ?? finiteMoney(ledger.paidTotal);
        const newDiscountTotal = finiteMoney(ledger.discountTotal) + receiptDiscount;
        const newStatus = isFullWaiver
          ? resolveLedgerStatus({
              amount: finiteMoney(ledger.amount),
              paidTotal: newPaidTotal,
              discountTotal: newDiscountTotal,
              isFullWaiver: true,
            })
          : cashLine!.newStatus;
        return {
          ledgerId: allocation.ledgerId,
          classId: String(ledger.classId || ''),
          amount: finiteMoney(allocation.amount),
          ...discountFields,
          discountAmount: receiptDiscount,
          siblingDiscountAmount: siblingGrant,
          newPaidTotal,
          newDiscountTotal,
          newSiblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal) + siblingGrant,
          newStatus,
        };
      }
    );

    const seq = await reserveNextCounterSequence(tx, db, {
      counterId: `receipts_${dateStr}`,
      collectionName: 'receipts',
      numberField: 'receiptNo',
      prefix,
    });
    const receiptNo = `${prefix}${String(seq).padStart(3, '0')}`;
    const transactionGroupId = `receipt:${receiptRef.id}`;
    const now = new Date().toISOString();
    const classIds = [
      ...new Set(receiptAllocations.map((allocation) => allocation.classId).filter(Boolean)),
    ];
    const receiptData: Record<string, unknown> = {
      receiptNo,
      type: 'tuition',
      flowVersion: 'wallet-manual-v2',
      transactionGroupId,
      studentId: data.studentId,
      classId: receiptAllocations[0]?.classId || String(student.classId || ''),
      ...(receiptAllocations.length === 1
        ? { ledgerId: receiptAllocations[0].ledgerId }
        : {}),
      amountReceived: finiteMoney(data.amountReceived),
      allocations: receiptAllocations,
      classIds,
      walletBalanceBefore,
      walletBalanceAfter: cashPlan.endingBalance,
      paymentMethod: data.paymentMethod || 'cash',
      receivedDate: data.receivedDate || now.slice(0, 10),
      status: 'posted',
      note: data.note || '',
      createdBy: uid,
      createdByRole: userInfo.role,
      createdByName: userInfo.name,
      createdAt: now,
      updatedAt: now,
    };
    if (receiptAllocations.length > 1) {
      receiptData.notificationSkippedReason = 'multiple_ledger_allocations';
    }

    tx.set(receiptRef, receiptData);
    receiptAllocations.forEach((allocation) => {
      tx.update(db.collection('course_fee_ledgers').doc(allocation.ledgerId), {
        paidTotal: allocation.newPaidTotal,
        discountTotal: allocation.newDiscountTotal,
        siblingDiscountTotal: allocation.newSiblingDiscountTotal,
        status: allocation.newStatus,
        updatedAt: now,
      });
    });
    tx.update(studentRef, { walletBalance: cashPlan.endingBalance, updatedAt: now });

    let groupSequence = 0;
    if (finiteMoney(data.amountReceived) > 0) {
      tx.set(db.collection('wallet_transactions').doc(), {
        schemaVersion: 2,
        transactionGroupId,
        groupSequence: groupSequence++,
        source: 'manual_receipt',
        studentId: data.studentId,
        type: 'deposit',
        amount: finiteMoney(data.amountReceived),
        status: 'posted',
        receiptId: receiptRef.id,
        receiptNo,
        note: data.note || '',
        createdBy: uid,
        createdByRole: userInfo.role,
        createdByName: userInfo.name,
        createdAt: now,
        postedAt: now,
      });
    }
    receiptAllocations
      .filter((allocation) => allocation.amount > 0)
      .forEach((allocation) => {
        tx.set(db.collection('wallet_transactions').doc(), {
          schemaVersion: 2,
          transactionGroupId,
          groupSequence: groupSequence++,
          source: 'manual_receipt',
          studentId: data.studentId,
          type: 'allocation',
          amount: allocation.amount,
          status: 'posted',
          receiptId: receiptRef.id,
          receiptNo,
          ledgerId: allocation.ledgerId,
          classId: allocation.classId,
          note: data.note || '',
          createdBy: uid,
          createdByRole: userInfo.role,
          createdByName: userInfo.name,
          createdAt: now,
          postedAt: now,
        });
      });

    const activePaymentRefs = new Map<string, AppDocumentStore.DocumentReference>();
    activePaymentSnaps.forEach((snapshot) => {
      snapshot.docs.forEach((paymentDoc) => {
        activePaymentRefs.set(paymentDoc.ref.path, paymentDoc.ref);
      });
    });
    activePaymentRefs.forEach((paymentRef) => {
      tx.update(paymentRef, {
        status: 'stale',
        staleReason: 'manual_receipt_posted',
        accountingResolution: 'manual_receipt_posted_while_gateway_session_active',
        manualReceiptId: receiptRef.id,
        manualReceiptNo: receiptNo,
        manualReceiptAmount: finiteMoney(data.amountReceived),
        manualReceiptPostedBy: uid,
        manualReceiptPostedAt: now,
        updatedAt: now,
      });
    });

    const response = {
      success: true as const,
      id: receiptRef.id,
      receiptNo,
      transactionGroupId,
      newBalance: cashPlan.endingBalance,
    };
    tx.set(idempotencyRef, {
      type: POST_OPERATION,
      uid,
      idempotencyKey: data.idempotencyKey,
      requestFingerprint: fingerprint,
      ledgerIds: uniqueLedgerIds,
      status: 'completed',
      response,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      replay: false,
      response,
      receipt: { id: receiptRef.id, ...receiptData },
      ledgerIds: uniqueLedgerIds,
    };
  });
}

export async function voidWalletManualReceipt(input: {
  db: AppDocumentStore.DocumentStore;
  receiptId: string;
  idempotencyKey: string;
  reason: string;
  uid: string;
  userInfo: Actor;
}): Promise<{ replay: boolean; response: { success: true; newBalance: number } }> {
  const { db, receiptId, idempotencyKey, uid, userInfo } = input;
  assertActorAllowed(userInfo);
  const reason = input.reason.trim();
  if (!reason) {
    throw financeError(400, 'wallet_void_reason_required', 'Void reason is required');
  }
  const fingerprint = requestFingerprint({ receiptId, reason });
  const idempotencyRef = db
    .collection('finance_idempotency_keys')
    .doc(`${uid}:${idempotencyKey}`);
  const receiptRef = db.collection('receipts').doc(receiptId);

  return runStudentIdentityMutationTransaction(
    db,
    { actorId: uid, operation: 'finance:receipts:void' },
    async (tx) => {
    const idempotencySnap = await tx.get(idempotencyRef);
    if (idempotencySnap.exists) {
      const stored = idempotencySnap.data() || {};
      assertIdempotencyReplay(stored, VOID_OPERATION, fingerprint);
      return { replay: true, response: stored.response };
    }

    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists) {
      throw financeError(400, 'wallet_receipt_not_found', 'Receipt not found');
    }
    const receipt = receiptSnap.data() || {};
    if (receipt.flowVersion !== 'wallet-manual-v2') {
      throw financeError(400, 'wallet_receipt_not_v2', 'Receipt is not a wallet manual receipt');
    }
    if (receipt.status !== 'posted') {
      throw financeError(400, 'wallet_receipt_not_posted', 'Only posted receipts can be voided');
    }
    const allocations = Array.isArray(receipt.allocations)
      ? (receipt.allocations as ReceiptAllocationSnapshot[])
      : [];
    const uniqueLedgerIds = [...new Set(allocations.map((allocation) => allocation.ledgerId))];
    if (uniqueLedgerIds.length !== allocations.length) {
      throw financeError(409, 'wallet_void_ledger_dependency', 'Receipt allocation data is inconsistent');
    }

    const studentRef = db.collection('students').doc(String(receipt.studentId || ''));
    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists) {
      throw financeError(400, 'wallet_student_not_found', 'Student not found');
    }
    const student = studentSnap.data() || {};
    const ledgerRefs = uniqueLedgerIds.map((ledgerId) =>
      db.collection('course_fee_ledgers').doc(ledgerId)
    );
    const ledgerSnaps = await Promise.all(ledgerRefs.map((ledgerRef) => tx.get(ledgerRef)));
    const ledgerById = new Map<string, AppDocumentStore.DocumentData>();
    ledgerSnaps.forEach((ledgerSnap, index) => {
      if (!ledgerSnap.exists) {
        throw financeError(400, 'wallet_ledger_not_found', `Ledger not found: ${uniqueLedgerIds[index]}`);
      }
      ledgerById.set(uniqueLedgerIds[index], ledgerSnap.data() || {});
    });

    const transactionGroupId = String(receipt.transactionGroupId || `receipt:${receiptId}`);
    const walletGroupSnap = await tx.get(
      db.collection('wallet_transactions').where('transactionGroupId', '==', transactionGroupId)
    );
    for (const walletRow of walletGroupSnap.docs) {
      const data = walletRow.data() || {};
      if (
        data.schemaVersion !== 2 ||
        data.source !== 'manual_receipt' ||
        data.status !== 'posted'
      ) {
        throw financeError(
          409,
          'wallet_void_has_dependencies',
          'Void dependent wallet transactions before voiding this receipt'
        );
      }
    }

    const cashVoidPlan = planManualReceiptVoid({
      walletBalance: finiteMoney(student.walletBalance),
      receiptAmount: finiteMoney(receipt.amountReceived),
      allocations: allocations.map((allocation) => {
        const ledger = ledgerById.get(allocation.ledgerId)!;
        return {
          ledgerId: allocation.ledgerId,
          amount: finiteMoney(allocation.amount),
          ledgerPaidTotal: finiteMoney(ledger.paidTotal),
          ledgerAmount: finiteMoney(ledger.amount),
          ledgerDiscountTotal: finiteMoney(ledger.discountTotal),
        };
      }),
    });
    const paidUpdateByLedger = new Map(
      cashVoidPlan.ledgerUpdates.map((update) => [update.ledgerId, update])
    );
    const ledgerUpdates = allocations.map((allocation) => {
      const ledger = ledgerById.get(allocation.ledgerId)!;
      const discountAmount = finiteMoney(allocation.discountAmount);
      const siblingDiscountAmount = finiteMoney(allocation.siblingDiscountAmount);
      const currentDiscountTotal = finiteMoney(ledger.discountTotal);
      const currentSiblingDiscountTotal = finiteMoney(ledger.siblingDiscountTotal);
      if (
        currentDiscountTotal < discountAmount ||
        currentSiblingDiscountTotal < siblingDiscountAmount
      ) {
        throw financeError(
          409,
          'wallet_void_ledger_dependency',
          `Cannot void receipt because ledger ${allocation.ledgerId} has dependent changes`
        );
      }
      const paidUpdate = paidUpdateByLedger.get(allocation.ledgerId)!;
      const newDiscountTotal = currentDiscountTotal - discountAmount;
      const newSiblingDiscountTotal = currentSiblingDiscountTotal - siblingDiscountAmount;
      return {
        ledgerId: allocation.ledgerId,
        paidTotal: paidUpdate.newPaidTotal,
        discountTotal: newDiscountTotal,
        siblingDiscountTotal: newSiblingDiscountTotal,
        status: resolveLedgerStatus({
          amount: finiteMoney(ledger.amount),
          paidTotal: paidUpdate.newPaidTotal,
          discountTotal: newDiscountTotal,
          requirePositiveEffective: true,
        }),
      };
    });

    const now = new Date().toISOString();
    tx.update(receiptRef, {
      status: 'void',
      voidReason: reason,
      voidedAt: now,
      voidedBy: uid,
      voidedByName: userInfo.name,
      updatedAt: now,
    });
    ledgerUpdates.forEach((update) => {
      tx.update(db.collection('course_fee_ledgers').doc(update.ledgerId), {
        paidTotal: update.paidTotal,
        discountTotal: update.discountTotal,
        siblingDiscountTotal: update.siblingDiscountTotal,
        status: update.status,
        updatedAt: now,
      });
    });
    tx.update(studentRef, { walletBalance: cashVoidPlan.endingBalance, updatedAt: now });
    walletGroupSnap.docs.forEach((walletRow) => {
      tx.update(walletRow.ref, {
        status: 'void',
        voidReason: reason,
        voidedAt: now,
        voidedBy: uid,
        voidedByName: userInfo.name,
        updatedAt: now,
      });
    });

    const response = { success: true as const, newBalance: cashVoidPlan.endingBalance };
    tx.set(idempotencyRef, {
      type: VOID_OPERATION,
      uid,
      idempotencyKey,
      requestFingerprint: fingerprint,
      status: 'completed',
      response,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { replay: false, response };
  });
}
