import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentReference } from '@/server/db/documentStore.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { finiteMoney } from './shared.js';
import {
  createWalletAllocationSchema,
  validateBody,
  voidFinanceMutationSchema,
} from '../../lib/validation/validations.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { ledgerRemaining } from '../../../../shared/money.js';
import {
  planStandaloneAllocationVoid,
  planWalletAllocations,
  type WalletAllocationLedger,
} from '../../../../shared/walletAllocation.js';
import { planWalletDepositVoid } from './walletCore.js';
import { buildWalletHistory } from './walletHistory.js';
import { readCanonicalStudentReadControl } from '../../lib/student/canonicalStudentReadControl.js';
import { collectCanonicalStudentDirectoryProjection } from '../../lib/student/canonicalStudentReadRepository.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

function errorStatus(err: unknown): number {
  return Number((err as { statusCode?: number })?.statusCode || 500);
}

/**
 * `finance_idempotency_keys` is shared with receipts and expenses and is keyed
 * only by `${uid}:${key}`, so a key reused across flows would otherwise replay
 * the *other* flow's response and silently skip this money movement. Replay
 * only for a matching operation; refuse anything else with a 409.
 */
function readIdempotentReplay<T>(
  snap: { exists: boolean; data: () => Record<string, unknown> | undefined },
  expectedType: string,
  expectedFingerprint?: string
): T | null {
  if (!snap.exists) return null;
  const stored = snap.data() || {};
  if (
    String(stored.type || '') !== expectedType ||
    (expectedFingerprint !== undefined &&
      String(stored.requestFingerprint || '') !== expectedFingerprint)
  ) {
    throw Object.assign(
      new Error('This idempotency key was already used by a different finance operation'),
      { statusCode: 409, errorCode: 'idempotency_key_conflict' }
    );
  }
  return (stored.response as T) || null;
}

function requestFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function walletError(errorCode: string, message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode, errorCode });
}

/**
 * Accounting only ever receives non-archived classes from the read channel, so
 * a class label resolved on the client is blank for every student whose course
 * has closed. Wallet responses carry the label resolved here instead.
 */
function buildClassNameMap(classSnap: {
  docs: Array<{ id: string; data: () => Record<string, unknown> | undefined }>;
}): Map<string, string> {
  return new Map(classSnap.docs.map((docSnap) => [docSnap.id, String(docSnap.data()?.name || '')]));
}

type WalletContextLedger = Record<string, unknown> & {
  id: string;
  amount?: unknown;
  paidTotal?: unknown;
  discountTotal?: unknown;
};

type WalletAllocationGroupRow = Record<string, unknown> & {
  id: string;
  ref: DocumentReference;
  schemaVersion?: unknown;
  transactionGroupId?: unknown;
  source?: unknown;
  studentId?: unknown;
  ledgerId?: unknown;
  type?: unknown;
  status?: unknown;
  amount?: unknown;
};

function sendError(res: ApiResponse, err: unknown, fallback: string) {
  const statusCode = errorStatus(err);
  const errorCode =
    String((err as { errorCode?: string })?.errorCode || '') ||
    (statusCode === 400
      ? 'bad_request'
      : statusCode === 404
        ? 'not_found'
        : statusCode === 409
          ? 'conflict'
          : 'internal_error');
  return res.status(statusCode).json({
    success: false,
    errorCode,
    error:
      (statusCode === 400 || statusCode === 404 || statusCode === 409) && err instanceof Error
        ? err.message
        : fallback,
  });
}

export async function handleWallet(
  req: ApiRequest,
  res: ApiResponse,
  id: string,
  action: string,
  uid: string,
  userInfo: { role: string; name: string }
) {
  const db = getDb();

  if (action === 'deposit-and-post' && req.method === 'POST') {
    return res.status(410).json({
      success: false,
      errorCode: 'wallet_top_up_retired',
      error: 'Create a manual receipt to add money to a student wallet',
    });
  }

  if (action === 'student-context' && req.method === 'GET') {
    try {
      const studentId = String(req.query.studentId || '').trim();
      if (!studentId) {
        return res.status(400).json({ success: false, error: 'Missing studentId' });
      }
      const [studentSnap, ledgerSnap, classSnap] = await Promise.all([
        db.collection('students').doc(studentId).get(),
        db.collection('course_fee_ledgers').where('studentId', '==', studentId).get(),
        db.collection('classes').get(),
      ]);
      if (!studentSnap.exists) {
        throw walletError('wallet_student_not_found', 'Student not found', 404);
      }
      const classNameById = buildClassNameMap(classSnap);
      const ledgers = ledgerSnap.docs
        .map(
          (docSnap) =>
            ({
              ...(docSnap.data() || {}),
              id: docSnap.id,
              className: classNameById.get(String(docSnap.data()?.classId || '')) || '',
            }) as WalletContextLedger
        )
        .filter((ledger) => ledgerRemaining(ledger) > 0);
      return res.json({
        success: true,
        studentId,
        walletBalance: finiteMoney(studentSnap.data()?.walletBalance),
        ledgers,
      });
    } catch (err) {
      console.error('[Wallet] student-context error:', err);
      return sendError(res, err, 'Failed to load wallet allocation context');
    }
  }

  if (action === 'allocate-and-post' && req.method === 'POST') {
    try {
      const body = normalizeBody(req.body);
      const val = validateBody(createWalletAllocationSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }
      const { idempotencyKey, studentId, allocations } = val.data;
      const fingerprint = requestFingerprint({ studentId, allocations });
      const idempotencyRef = db
        .collection('finance_idempotency_keys')
        .doc(`${uid}:${idempotencyKey}`);
      const studentRef = db.collection('students').doc(studentId);
      const ledgerRefs = allocations.map((allocation) =>
        db.collection('course_fee_ledgers').doc(allocation.ledgerId)
      );
      const walletRefs = allocations.map(() => db.collection('wallet_transactions').doc());
      const transactionGroupId = `manual-allocation:${walletRefs[0].id}`;

      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:wallet:allocate-and-post' },
        async (tx) => {
        const replay = readIdempotentReplay<{
          success: true;
          transactionGroupId: string;
          newBalance: number;
        }>(await tx.get(idempotencyRef), 'wallet-manual-allocation-post', fingerprint);
        if (replay) return { replay: true, response: replay };

        const studentSnap = await tx.get(studentRef);
        if (!studentSnap.exists) {
          throw walletError('wallet_student_not_found', 'Student not found', 404);
        }
        const ledgerSnaps = [];
        for (const ledgerRef of ledgerRefs) ledgerSnaps.push(await tx.get(ledgerRef));
        const ledgers: WalletAllocationLedger[] = ledgerSnaps.map((snap, index) => ({
          id: allocations[index].ledgerId,
          studentId: String(snap.data()?.studentId || ''),
          classId: String(snap.data()?.classId || ''),
          amount: finiteMoney(snap.data()?.amount),
          paidTotal: finiteMoney(snap.data()?.paidTotal),
          discountTotal: finiteMoney(snap.data()?.discountTotal),
          siblingDiscountTotal: finiteMoney(snap.data()?.siblingDiscountTotal),
        }));
        ledgerSnaps.forEach((snap, index) => {
          if (!snap.exists) {
            throw walletError(
              'wallet_ledger_not_found',
              `Ledger not found: ${allocations[index].ledgerId}`,
              404
            );
          }
        });

        const planned = planWalletAllocations({
          studentId,
          walletBalance: finiteMoney(studentSnap.data()?.walletBalance),
          depositAmount: 0,
          allocations,
          ledgers,
        });
        const now = new Date().toISOString();
        planned.lines.forEach((line, index) => {
          tx.update(ledgerRefs[index], {
            paidTotal: line.newPaidTotal,
            status: line.newStatus,
            updatedAt: now,
          });
          tx.set(walletRefs[index], {
            schemaVersion: 2,
            transactionGroupId,
            groupSequence: index,
            source: 'manual_allocation',
            studentId,
            ledgerId: line.ledgerId,
            classId: line.classId,
            type: 'allocation',
            status: 'posted',
            amount: line.amount,
            createdBy: uid,
            createdByName: userInfo.name,
            createdByRole: userInfo.role,
            createdAt: now,
            postedAt: now,
            updatedAt: now,
          });
        });
        tx.update(studentRef, { walletBalance: planned.endingBalance, updatedAt: now });
        const response = {
          success: true as const,
          transactionGroupId,
          newBalance: planned.endingBalance,
        };
        tx.set(idempotencyRef, {
          type: 'wallet-manual-allocation-post',
          uid,
          idempotencyKey,
          requestFingerprint: fingerprint,
          status: 'completed',
          response,
          createdAt: now,
        });
        return {
          replay: false,
          response,
          allocatedTotal: planned.allocatedTotal,
          studentId,
        };
      });

      if (!result.replay) {
        await writeCriticalAuditLog(db, {
          userId: uid,
          userRole: userInfo.role,
          userName: userInfo.name,
          action: 'create',
          collection: 'wallet_transactions',
          documentId: result.response.transactionGroupId,
          metadata: {
            action: 'allocate-and-post',
            transactionGroupId: result.response.transactionGroupId,
            allocatedTotal: result.allocatedTotal,
            newBalance: result.response.newBalance,
            studentId: result.studentId,
          },
          ip: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
        });
        await refreshAccountingStudentSummariesAfterCommit(
          db,
          [studentId],
          'wallet-manual-allocation-posted',
          { actorId: uid, operation: 'finance:wallet:allocate-and-post' }
        );
        await touchRealtimeEvent('finance-ledger');
        await touchRealtimeEvent('accounting-student-finance');
        await touchRealtimeEvent('accounting-students');
        await touchRealtimeEvent('parent-tuition', { targetId: studentId });
      }
      return res.status(result.replay ? 200 : 201).json(result.response);
    } catch (err) {
      console.error('[Wallet] allocate-and-post error:', err);
      return sendError(res, err, 'Failed to allocate wallet balance');
    }
  }

  if (action === 'void' && req.method === 'POST') {
    if (!id) return res.status(400).json({ success: false, error: 'Missing transaction id' });
    try {
      const body = normalizeBody(req.body);
      const val = validateBody(voidFinanceMutationSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }
      const { idempotencyKey, reason } = val.data;
      const fingerprint = requestFingerprint({ transactionId: id, reason });
      const walletTxRef = db.collection('wallet_transactions').doc(id);
      const idempotencyRef = db
        .collection('finance_idempotency_keys')
        .doc(`${uid}:${idempotencyKey}`);

      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:wallet:void' },
        async (tx) => {
        // DocumentStore transactions require ALL reads before the first write.
        const idempotencySnap = await tx.get(idempotencyRef);
        if (idempotencySnap.exists) {
          const stored = idempotencySnap.data() || {};
          const storedType = String(stored.type || '');
          if (
            !['wallet-void', 'wallet-manual-allocation-group-void'].includes(storedType) ||
            String(stored.requestFingerprint || '') !== fingerprint
          ) {
            throw walletError(
              'idempotency_key_conflict',
              'This idempotency key was already used by a different finance operation',
              409
            );
          }
          return {
            replay: true,
            response: stored.response as { success: true; newBalance: number },
            newBalance: 0,
            amount: 0,
            studentId: '',
            transactionGroupId: '',
            auditAction: 'void',
          };
        }
        const walletTxSnap = await tx.get(walletTxRef);
        const walletTx = walletTxSnap.exists ? walletTxSnap.data() : undefined;
        if (!walletTx) {
          throw walletError('wallet_transaction_not_found', 'Wallet transaction not found', 404);
        }
        if (Number(walletTx.schemaVersion) === 2 && walletTx.source === 'manual_receipt') {
          throw walletError(
            'wallet_void_via_receipt',
            'Void this wallet transaction through its manual receipt'
          );
        }
        if (Number(walletTx.schemaVersion) === 2 && walletTx.source === 'student_refund') {
          throw walletError(
            'wallet_void_via_expense',
            'Void this wallet transaction through its refund expense'
          );
        }

        if (
          Number(walletTx.schemaVersion) === 2 &&
          walletTx.source === 'manual_allocation' &&
          walletTx.type === 'allocation'
        ) {
          const transactionGroupId = String(walletTx.transactionGroupId || '');
          if (!transactionGroupId) {
            throw walletError(
              'wallet_invalid_transaction_group',
              'Wallet allocation group is missing'
            );
          }
          const groupSnap = await tx.get(
            db
              .collection('wallet_transactions')
              .where('transactionGroupId', '==', transactionGroupId)
          );
          const groupRows = groupSnap.docs.map(
            (docSnap) =>
              ({
                ...(docSnap.data() || {}),
                id: docSnap.id,
                ref: docSnap.ref,
              }) as WalletAllocationGroupRow
          );
          if (
            !groupRows.length ||
            groupRows.some(
              (row) =>
                Number(row.schemaVersion) !== 2 ||
                row.source !== 'manual_allocation' ||
                row.type !== 'allocation' ||
                row.status !== 'posted'
            )
          ) {
            throw walletError(
              'wallet_allocation_group_not_posted',
              'The whole wallet allocation group must be posted before it can be voided',
              409
            );
          }
          const studentId = String(walletTx.studentId || '');
          const studentRef = db.collection('students').doc(studentId);
          const studentSnap = await tx.get(studentRef);
          if (!studentSnap.exists) {
            throw walletError('wallet_student_not_found', 'Student not found', 404);
          }
          const ledgerRefs = groupRows.map((row) =>
            db.collection('course_fee_ledgers').doc(String(row.ledgerId || ''))
          );
          const ledgerSnaps = [];
          for (const ledgerRef of ledgerRefs) ledgerSnaps.push(await tx.get(ledgerRef));
          ledgerSnaps.forEach((snap, index) => {
            if (!snap.exists) {
              throw walletError(
                'wallet_ledger_not_found',
                `Ledger not found: ${String(groupRows[index].ledgerId || '')}`,
                404
              );
            }
          });

          const planned = planStandaloneAllocationVoid({
            walletBalance: finiteMoney(studentSnap.data()?.walletBalance),
            allocations: groupRows.map((row, index) => ({
              ledgerId: String(row.ledgerId || ''),
              amount: finiteMoney(row.amount),
              ledgerPaidTotal: finiteMoney(ledgerSnaps[index].data()?.paidTotal),
              ledgerAmount: finiteMoney(ledgerSnaps[index].data()?.amount),
              ledgerDiscountTotal: finiteMoney(ledgerSnaps[index].data()?.discountTotal),
            })),
          });
          const now = new Date().toISOString();
          planned.ledgerUpdates.forEach((ledgerUpdate, index) => {
            tx.update(ledgerRefs[index], {
              paidTotal: ledgerUpdate.newPaidTotal,
              status: ledgerUpdate.newStatus,
              updatedAt: now,
            });
          });
          groupRows.forEach((row) => {
            tx.update(row.ref, {
              status: 'void',
              voidReason: reason,
              voidedAt: now,
              voidedBy: uid,
              voidedByName: userInfo.name,
              updatedAt: now,
            });
          });
          tx.update(studentRef, { walletBalance: planned.endingBalance, updatedAt: now });
          const response = {
            success: true as const,
            transactionGroupId,
            newBalance: planned.endingBalance,
          };
          tx.set(idempotencyRef, {
            type: 'wallet-manual-allocation-group-void',
            uid,
            idempotencyKey,
            requestFingerprint: fingerprint,
            status: 'completed',
            response,
            createdAt: now,
          });
          return {
            replay: false,
            response,
            newBalance: planned.endingBalance,
            amount: groupRows.reduce((sum, row) => sum + finiteMoney(row.amount), 0),
            studentId,
            transactionGroupId,
            auditAction: 'void-allocation-group',
          };
        }

        const studentRef = db.collection('students').doc(String(walletTx?.studentId || 'missing'));
        const studentSnap = await tx.get(studentRef);
        const receiptId = String(walletTx?.receiptId || '');
        const receiptRef = receiptId ? db.collection('receipts').doc(receiptId) : null;
        const receiptSnap = receiptRef ? await tx.get(receiptRef) : null;

        const { newBalance, amount } = planWalletDepositVoid({
          walletTx,
          student: studentSnap.exists ? studentSnap.data() : undefined,
          reason,
        });

        const now = new Date().toISOString();
        tx.update(walletTxRef, {
          status: 'void',
          voidReason: reason,
          voidedAt: now,
          voidedBy: uid,
          voidedByName: userInfo.name,
          updatedAt: now,
        });
        tx.update(studentRef, { walletBalance: newBalance, updatedAt: now });
        if (receiptRef && receiptSnap?.exists && receiptSnap.data()?.status === 'posted') {
          tx.update(receiptRef, {
            status: 'void',
            voidReason: reason,
            voidedAt: now,
            voidedBy: uid,
            voidedByName: userInfo.name,
            updatedAt: now,
          });
        }

        const response = { success: true, newBalance };
        tx.set(idempotencyRef, {
          type: 'wallet-void',
          uid,
          idempotencyKey,
          requestFingerprint: fingerprint,
          status: 'completed',
          response,
          createdAt: now,
        });

        return {
          replay: false,
          response,
          newBalance,
          amount,
          studentId: String(walletTx?.studentId || ''),
          transactionGroupId: String(walletTx?.transactionGroupId || ''),
          auditAction: 'void',
        };
      });

      if (!result.replay) {
        await writeCriticalAuditLog(db, {
          userId: uid,
          userRole: userInfo.role,
          userName: userInfo.name,
          action: 'update',
          collection: 'wallet_transactions',
          documentId: result.transactionGroupId || id,
          metadata: {
            action: result.auditAction,
            voidReason: reason,
            newBalance: result.newBalance,
            amount: result.amount,
            studentId: result.studentId,
          },
          ip: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
        });
        await refreshAccountingStudentSummariesAfterCommit(
          db,
          result.studentId ? [result.studentId] : [],
          result.auditAction === 'void-allocation-group'
            ? 'wallet-manual-allocation-voided'
            : 'wallet-deposit-voided',
          { actorId: uid, operation: 'finance:wallet:void' }
        );
        await touchRealtimeEvent('finance-receipt');
        await touchRealtimeEvent('finance-ledger');
        await touchRealtimeEvent('accounting-student-finance');
        await touchRealtimeEvent('accounting-students');
        if (result.studentId) {
          await touchRealtimeEvent('parent-tuition', { targetId: result.studentId });
        }
      }
      return res.status(200).json(result.response);
    } catch (err) {
      console.error('[Wallet] void error:', err);
      return sendError(res, err, 'Failed to void wallet transaction');
    }
  }

  if (action === 'transactions' && req.method === 'GET') {
    try {
      const studentId = String(req.query.studentId || '');
      if (!studentId) return res.status(400).json({ success: false, error: 'Missing studentId' });
      const [studentSnap, txSnap, classSnap] = await Promise.all([
        db.collection('students').doc(studentId).get(),
        db.collection('wallet_transactions').where('studentId', '==', studentId).get(),
        db.collection('classes').get(),
      ]);
      if (!studentSnap.exists) {
        return res.status(404).json({ success: false, error: 'Student not found' });
      }
      const classNameById = buildClassNameMap(classSnap);
      const student = studentSnap.data() || {};
      const startedAt = String(student.walletHistoryStartedAt || '').trim();
      const history = buildWalletHistory({
        opening: startedAt
          ? {
              startedAt,
              balance: finiteMoney(student.walletOpeningBalance),
            }
          : null,
        transactions: txSnap.docs.map(
          (docSnap) =>
            ({
              id: docSnap.id,
              ...(docSnap.data() || {}),
            }) as Parameters<typeof buildWalletHistory>[0]['transactions'][number]
        ),
        fallbackWalletBalance: finiteMoney(student.walletBalance),
      });
      return res.json({
        success: true,
        ...history,
        transactions: history.transactions.map((row) => ({
          ...row,
          className: classNameById.get(String(row.classId || '')) || '',
        })),
      });
    } catch (err) {
      console.error('[Wallet] transactions error:', err);
      return sendError(res, err, 'Failed to load wallet transactions');
    }
  }

  if (action === 'balances' && req.method === 'GET') {
    try {
      /**
       * Accounting never receives archived classes from the read channel, so a
       * class label resolved on the client is blank for every student whose
       * course has already closed. Resolve it here, where every class is in
       * scope, and ship the label with the row.
       */
      const control = await readCanonicalStudentReadControl(db);
      const classSnap = await db.collection('classes').get();
      const classById = new Map(
        classSnap.docs.map((docSnap) => [
          docSnap.id,
          {
            name: String(docSnap.data()?.name || ''),
            status: String(docSnap.data()?.status || 'active'),
          },
        ])
      );

      const withClassLabel = (row: {
        id: string;
        data: Record<string, unknown>;
        classId: string;
        placementStatus?: string;
      }) => {
        const classRow = row.classId ? classById.get(row.classId) : undefined;
        return {
          id: row.id,
          name: String(row.data.name || ''),
          code: String(row.data.code || row.data.studentId || ''),
          dob: String(row.data.dob || ''),
          classId: row.classId,
          className: classRow?.name || '',
          classStatus: classRow?.status || '',
          contact: String(row.data.contact || ''),
          studentLifecycle: String(row.data.studentLifecycle || ''),
          enrollmentStatus: String(row.data.enrollmentStatus || ''),
          isRevoked: Boolean(row.data.isRevoked),
          walletBalance: finiteMoney(row.data.walletBalance),
          // Absent in `legacy_compare`, where the profile fields above are all
          // there is. Present from `canonical_preferred`, where the chip beside
          // a balance should say what the enrollment says rather than what the
          // profile last recorded.
          ...(row.placementStatus ? { placementStatus: row.placementStatus } : {}),
        };
      };

      if (control.mode === 'legacy_compare') {
        const snap = await db.collection('students').get();
        const students = snap.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          return withClassLabel({ id: docSnap.id, data, classId: String(data.classId || '') });
        });
        return res.json({ success: true, students });
      }

      // One row per human. Two rows for one child on the balance list is a
      // debt chased twice and a credit nobody can find — the split-money half
      // of the duplicate-profile incident.
      // The named complete traversal, not a limit large enough to mean
      // "everything": those look the same at a call site, and only one of them
      // is a decision somebody made. It advances through bounded pages and
      // stops at the program's 3000-profile cap.
      const projection = await collectCanonicalStudentDirectoryProjection(db);
      const students = projection.rows.map((row) =>
        withClassLabel({
          id: row.canonicalProfileId,
          data: row.profile,
          // From the open enrollment: the profile's copy points at a course
          // this student may have finished, and an operator chasing the
          // balance would go to the wrong teacher.
          classId: row.currentClassId ?? '',
          placementStatus: row.placementStatus,
        })
      );
      return res.json({ success: true, students });
    } catch (err) {
      console.error('[Wallet] balances error:', err);
      return sendError(res, err, 'Failed to load wallet balances');
    }
  }

  return res.status(404).json({ success: false, error: 'Unknown wallet action' });
}
