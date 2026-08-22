import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { z } from 'zod';
import { FieldValue, type DocumentReference } from '@/server/db/documentStore.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import {
  getDailyPrefix,
  getNextFinanceSequence,
  previewNextFinanceSequence,
  finiteMoney,
} from './shared.js';
import {
  createExpenseSchema,
  createStudentWalletRefundSchema,
  validateBody,
} from '../../lib/validation/validations.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { planWalletRefund } from '../../../../shared/walletAllocation.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

function expenseError(errorCode: string, message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

function expenseErrorStatus(error: unknown): number {
  return Number((error as { statusCode?: number })?.statusCode || 500);
}

function refundFingerprint(data: z.infer<typeof createStudentWalletRefundSchema>): string {
  return JSON.stringify({
    studentId: data.studentId,
    amount: data.amount,
    paidDate: data.paidDate,
    payee: data.payee,
    reason: data.reason,
    note: data.note || '',
  });
}

export async function postStudentWalletRefund(
  req: ApiRequest,
  res: ApiResponse,
  data: z.infer<typeof createStudentWalletRefundSchema>,
  uid: string,
  userInfo: { role: string; name: string }
): Promise<ApiResponse> {
  const db = getDb();
  const fingerprint = refundFingerprint(data);
  const idempotencyRef = db
    .collection('finance_idempotency_keys')
    .doc(`${uid}:${data.idempotencyKey}`);
  const studentRef = db.collection('students').doc(data.studentId);
  const expenseRef = db.collection('expenses').doc();
  const walletTxRef = db.collection('wallet_transactions').doc();
  const { dateStr, prefix } = getDailyPrefix('expense');
  const counterRef = db.collection('counters').doc(`expenses_${dateStr}`);

  try {
    const result = await runStudentIdentityMutationTransaction(
      db,
      { actorId: uid, operation: 'finance:expenses:create-and-post' },
      async (tx) => {
      const idempotencySnap = await tx.get(idempotencyRef);
      if (idempotencySnap.exists) {
        const stored = idempotencySnap.data() || {};
        if (
          String(stored.type || '') !== 'expense-wallet-refund-create-and-post' ||
          String(stored.requestFingerprint || '') !== fingerprint
        ) {
          throw expenseError(
            'idempotency_key_conflict',
            'This idempotency key was already used by a different finance operation',
            409
          );
        }
        return { replay: true, response: stored.response };
      }

      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists) {
        throw expenseError('wallet_student_not_found', 'Student not found', 404);
      }
      const newBalance = planWalletRefund(
        finiteMoney(studentSnap.data()?.walletBalance),
        data.amount
      );
      const counterSnap = await tx.get(counterRef);
      const seq = Number(counterSnap.data()?.seq || 0) + 1;
      const expenseNo = `${prefix}${String(seq).padStart(3, '0')}`;
      const numberRef = db.collection('expense_numbers').doc(expenseNo);
      const numberSnap = await tx.get(numberRef);
      if (numberSnap.exists)
        throw expenseError('expense_number_collision', 'Expense number collision');

      const now = new Date().toISOString();
      const response = {
        success: true,
        id: expenseRef.id,
        expenseNo,
        status: 'posted',
        walletTransactionId: walletTxRef.id,
        newBalance,
      };
      tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(numberRef, { expenseId: expenseRef.id, createdAt: FieldValue.serverTimestamp() });
      tx.set(expenseRef, {
        expenseNo,
        type: 'wallet_refund',
        category: 'wallet_refund',
        studentId: data.studentId,
        studentName: String(studentSnap.data()?.name || ''),
        walletTransactionId: walletTxRef.id,
        amount: data.amount,
        paidDate: data.paidDate,
        payee: data.payee,
        reason: data.reason,
        note: data.note || '',
        purpose: '',
        createdBy: uid,
        createdByRole: userInfo.role,
        createdByName: userInfo.name,
        status: 'posted',
        createdAt: now,
        updatedAt: now,
      });
      tx.set(walletTxRef, {
        schemaVersion: 2,
        transactionGroupId: `student-refund:${walletTxRef.id}`,
        groupSequence: 0,
        source: 'student_refund',
        studentId: data.studentId,
        type: 'refund',
        amount: data.amount,
        status: 'posted',
        expenseId: expenseRef.id,
        expenseNo,
        note: data.note || '',
        reason: data.reason,
        createdBy: uid,
        createdByName: userInfo.name,
        createdAt: now,
        postedAt: now,
      });
      tx.update(studentRef, { walletBalance: newBalance, updatedAt: now });
      tx.set(idempotencyRef, {
        type: 'expense-wallet-refund-create-and-post',
        uid,
        idempotencyKey: data.idempotencyKey,
        requestFingerprint: fingerprint,
        status: 'completed',
        response,
        createdAt: now,
      });
      return { replay: false, response };
    });

    if (!result.replay) {
      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        userName: userInfo.name,
        action: 'create',
        collection: 'expenses',
        documentId: result.response.id,
        metadata: {
          action: 'wallet-refund-create-and-post',
          expenseNo: result.response.expenseNo,
          amount: data.amount,
          studentId: data.studentId,
          newBalance: result.response.newBalance,
        },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      await touchRealtimeEvent('finance-expense');
      await touchRealtimeEvent('finance-ledger');
      await touchRealtimeEvent('accounting-student-finance');
      await touchRealtimeEvent('accounting-students');
    }

    return res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    const statusCode = expenseErrorStatus(error);
    console.error('[Finance] Student wallet refund error:', error);
    return res.status(statusCode).json({
      success: false,
      errorCode: String((error as { errorCode?: string })?.errorCode || 'internal_error'),
      error:
        statusCode < 500 && error instanceof Error
          ? error.message
          : 'Failed to create student wallet refund',
    });
  }
}

export async function handleExpenses(
  req: ApiRequest,
  res: ApiResponse,
  id: string,
  action: string,
  uid: string,
  userInfo: { role: string; name: string }
) {
  const db = getDb();

  if (action === 'create-and-post' && req.method === 'POST') {
    try {
      const body = normalizeBody(req.body);
      const idempotencyKey = String(body.idempotencyKey || '').trim();
      if (!idempotencyKey) {
        return res.status(400).json({ success: false, error: 'Missing idempotency key' });
      }

      if (body.type === 'wallet_refund') {
        const refundValidation = validateBody(createStudentWalletRefundSchema, body);
        if (!refundValidation.success) {
          return res.status(400).json({
            success: false,
            error: (refundValidation as { success: false; error: string }).error,
          });
        }
        return postStudentWalletRefund(req, res, refundValidation.data, uid, userInfo);
      }

      const val = validateBody(createExpenseSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }

      const expenseData = {
        category: val.data.category || 'other',
        amount: val.data.amount,
        paidDate: val.data.paidDate,
        payee: val.data.payee,
        note: val.data.note || '',
        purpose: val.data.purpose || '',
        createdBy: uid,
        createdByRole: userInfo.role,
        createdByName: userInfo.name,
        status: 'posted',
      };

      const { dateStr, prefix } = getDailyPrefix('expense');
      const counterRef = db.collection('counters').doc(`expenses_${dateStr}`);
      const expenseRef = db.collection('expenses').doc();
      const idempotencyRef = db
        .collection('finance_idempotency_keys')
        .doc(`${uid}:${idempotencyKey}`);

      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:expenses:create-and-post' },
        async (tx) => {
        const idempotencySnap = await tx.get(idempotencyRef);
        if (idempotencySnap.exists) {
          return {
            replay: true,
            response: idempotencySnap.data()?.response,
          };
        }

        const counterSnap = await tx.get(counterRef);
        const seq = Number(counterSnap.data()?.seq || 0) + 1;
        const expenseNo = `${prefix}${String(seq).padStart(3, '0')}`;
        const numberRef = db.collection('expense_numbers').doc(expenseNo);
        const numberSnap = await tx.get(numberRef);
        if (numberSnap.exists) throw new Error('Expense number collision');

        const response = {
          success: true,
          id: expenseRef.id,
          expenseNo,
          status: 'posted',
        };

        tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(numberRef, { expenseId: expenseRef.id, createdAt: FieldValue.serverTimestamp() });
        tx.set(expenseRef, {
          ...expenseData,
          expenseNo,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(idempotencyRef, {
          type: 'expense-create-and-post',
          uid,
          idempotencyKey,
          status: 'completed',
          response,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { replay: false, response };
      });

      if (!result.replay) {
        await writeCriticalAuditLog(db, {
          userId: uid,
          userRole: userInfo.role,
          action: 'create',
          collection: 'expenses',
          documentId: result.response.id,
          metadata: {
            action: 'create-and-post',
            expenseNo: result.response.expenseNo,
            amount: expenseData.amount,
          },
          ip: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
        });

        await touchRealtimeEvent('finance-expense');
        await touchRealtimeEvent('finance-ledger');
        await touchRealtimeEvent('accounting-student-finance');
      }

      return res.status(result.replay ? 200 : 201).json(result.response);
    } catch (err) {
      console.error('[Finance] Create-and-post expense error:', err);
      return res.status(500).json({
        success: false,
        errorCode: 'internal_error',
        error: 'Failed to create and post expense',
      });
    }
  }

  if (action === 'create' && req.method === 'POST') {
    try {
      const body = normalizeBody(req.body);
      const val = validateBody(createExpenseSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }

      const expenseData = {
        category: val.data.category || 'other',
        amount: val.data.amount,
        paidDate: val.data.paidDate,
        payee: val.data.payee,
        note: val.data.note || '',
        purpose: val.data.purpose || '',
        createdBy: uid,
        createdByRole: userInfo.role,
        createdByName: userInfo.name,
        status: 'draft',
      };

      const { dateStr, prefix } = getDailyPrefix('expense');
      const counterRef = db.collection('counters').doc(`expenses_${dateStr}`);
      const expenseRef = db.collection('expenses').doc();
      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:expenses:create' },
        async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const seq = Number(counterSnap.data()?.seq || 0) + 1;
        const expenseNo = `${prefix}${String(seq).padStart(3, '0')}`;
        const numberRef = db.collection('expense_numbers').doc(expenseNo);
        const numberSnap = await tx.get(numberRef);
        if (numberSnap.exists) throw new Error('Expense number collision');

        tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(numberRef, { expenseId: expenseRef.id, createdAt: FieldValue.serverTimestamp() });
        tx.set(expenseRef, {
          ...expenseData,
          expenseNo,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { id: expenseRef.id, expenseNo };
      });
      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        action: 'create',
        collection: 'expenses',
        documentId: result.id,
        metadata: { expenseNo: result.expenseNo, amount: expenseData.amount },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      await touchRealtimeEvent('finance-expense');
      return res.status(201).json({ success: true, id: result.id, expenseNo: result.expenseNo });
    } catch (err) {
      console.error('[Finance] Create expense error:', err);
      return res.status(500).json({
        success: false,
        errorCode: 'internal_error',
        error: 'Failed to create expense',
      });
    }
  }

  if (action === 'next-number' && req.method === 'GET') {
    try {
      const { dateStr, prefix } = getDailyPrefix('expense');
      const seq = await previewNextFinanceSequence(
        db,
        `expenses_${dateStr}`,
        'expenses',
        'expenseNo',
        prefix
      );

      return res.json({
        success: true,
        expenseNo: `${prefix}${String(seq).padStart(3, '0')}`,
        preview: true,
        reserved: false,
      });
    } catch (err) {
      console.error('[Finance] Next expense number error:', err);
      return res.status(500).json({
        success: false,
        errorCode: 'internal_error',
        error: 'Failed to generate expense number',
      });
    }
  }

  if (action === 'post' && req.method === 'POST') {
    if (!id) return res.status(400).json({ success: false, error: 'Missing expense id' });
    try {
      const expenseRef = db.collection('expenses').doc(id);
      await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:expenses:post' },
        async (tx) => {
        const snap = await tx.get(expenseRef);
        if (!snap.exists) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
        if (snap.data()!.status !== 'draft') {
          throw Object.assign(new Error('Only draft expenses can be posted'), { statusCode: 400 });
        }
        tx.update(expenseRef, { status: 'posted', updatedAt: new Date().toISOString() });
      });
      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        userName: userInfo.name,
        action: 'update',
        collection: 'expenses',
        documentId: id,
        metadata: { action: 'post' },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      await touchRealtimeEvent('finance-expense');
      await touchRealtimeEvent('finance-ledger');
      await touchRealtimeEvent('accounting-student-finance');
      return res.json({ success: true });
    } catch (err) {
      console.error('[Finance] Post expense error:', err);
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode: number }).statusCode
          : 500;
      return res.status(statusCode).json({
        success: false,
        errorCode: statusCode >= 500 ? 'internal_error' : 'bad_request',
        error:
          statusCode >= 500
            ? 'Failed to post expense'
            : err instanceof Error
              ? err.message
              : 'Failed to post expense',
      });
    }
  }

  if (action === 'void' && req.method === 'POST') {
    if (!id) return res.status(400).json({ success: false, error: 'Missing expense id' });
    try {
      const body = normalizeBody(req.body);
      const voidReason = String(body.voidReason || body.reason || '').trim();
      const expenseRef = db.collection('expenses').doc(id);
      const voidResult = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:expenses:void' },
        async (tx) => {
        const snap = await tx.get(expenseRef);
        if (!snap.exists) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
        const expense = snap.data() || {};
        if (expense.status !== 'posted') {
          throw Object.assign(new Error('Only posted expenses can be voided'), { statusCode: 400 });
        }
        let walletTxRef: DocumentReference | null = null;
        let studentRef: DocumentReference | null = null;
        let restoredBalance: number | undefined;
        if (expense.type === 'wallet_refund') {
          const walletTransactionId = String(expense.walletTransactionId || '');
          const studentId = String(expense.studentId || '');
          if (!walletTransactionId || !studentId) {
            throw expenseError(
              'wallet_refund_link_missing',
              'Wallet refund is missing its linked transaction or student',
              409
            );
          }
          walletTxRef = db.collection('wallet_transactions').doc(walletTransactionId);
          studentRef = db.collection('students').doc(studentId);
          const walletTxSnap = await tx.get(walletTxRef);
          const studentSnap = await tx.get(studentRef);
          if (!walletTxSnap.exists || !studentSnap.exists) {
            throw expenseError(
              'wallet_refund_link_not_found',
              'Linked wallet refund transaction or student was not found',
              409
            );
          }
          const walletTransaction = walletTxSnap.data() || {};
          if (
            walletTransaction.type !== 'refund' ||
            walletTransaction.source !== 'student_refund' ||
            walletTransaction.status !== 'posted' ||
            String(walletTransaction.expenseId || '') !== id
          ) {
            throw expenseError(
              'wallet_refund_link_invalid',
              'Linked wallet refund transaction is not posted or does not match the expense',
              409
            );
          }
          restoredBalance =
            finiteMoney(studentSnap.data()?.walletBalance) + finiteMoney(walletTransaction.amount);
        }
        const now = new Date().toISOString();
        tx.update(expenseRef, {
          status: 'void',
          voidReason,
          voidedAt: now,
          voidedBy: uid,
          voidedByName: userInfo.name,
          updatedAt: now,
        });
        if (walletTxRef && studentRef && restoredBalance !== undefined) {
          tx.update(walletTxRef, {
            status: 'void',
            voidReason,
            voidedAt: now,
            voidedBy: uid,
            voidedByName: userInfo.name,
            updatedAt: now,
          });
          tx.update(studentRef, { walletBalance: restoredBalance, updatedAt: now });
        }
        return { newBalance: restoredBalance };
      });
      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        userName: userInfo.name,
        action: 'update',
        collection: 'expenses',
        documentId: id,
        metadata: { action: 'void', voidReason },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      await touchRealtimeEvent('finance-expense');
      await touchRealtimeEvent('finance-ledger');
      await touchRealtimeEvent('accounting-student-finance');
      return res.json({
        success: true,
        ...(voidResult.newBalance !== undefined ? { newBalance: voidResult.newBalance } : {}),
      });
    } catch (err) {
      console.error('[Finance] Void expense error:', err);
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode: number }).statusCode
          : 500;
      return res.status(statusCode).json({
        success: false,
        errorCode: statusCode >= 500 ? 'internal_error' : 'bad_request',
        error:
          statusCode >= 500
            ? 'Failed to void expense'
            : err instanceof Error
              ? err.message
              : 'Failed to void expense',
      });
    }
  }

  return res.status(404).json({ success: false, error: 'Unknown expense action' });
}
