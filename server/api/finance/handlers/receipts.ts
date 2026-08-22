import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue } from '@/server/db/documentStore.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import {
  DISCOUNT_TYPES,
  finiteMoney,
  getDailyPrefix,
  ledgerRemaining,
  previewReceiptNo,
} from './shared.js';
import { resolveLedgerStatus } from '../../../../shared/money.js';
import { enqueueReceiptPaymentConfirmation } from './receiptNotificationOutbox.js';
import { reserveNextCounterSequence } from '../../lib/documentStore/counterSequence.js';
import {
  createReceiptSchema,
  createWalletManualReceiptSchema,
  validateBody,
  voidFinanceMutationSchema,
} from '../../lib/validation/validations.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import {
  clampSiblingGrantForPost,
  computeReceiptDiscount,
  loadSiblingEligibility,
} from './receiptDiscount.js';
import {
  postWalletManualReceipt,
  voidWalletManualReceipt,
} from './manualReceiptWallet.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

export async function handleReceipts(
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
      const validationError = (message: string) =>
        Object.assign(new Error(message), { statusCode: 400 });
      const body = normalizeBody(req.body);
      const idempotencyKey = String(body.idempotencyKey || '').trim();
      if (!idempotencyKey) {
        return res.status(400).json({ success: false, error: 'Missing idempotency key' });
      }

      if (body.flowVersion === 'wallet-manual-v2') {
        const walletVal = validateBody(createWalletManualReceiptSchema, body);
        if (!walletVal.success) {
          return res.status(400).json({
            success: false,
            error: (walletVal as { success: false; error: string }).error,
          });
        }
        const walletResult = await postWalletManualReceipt({
          db,
          data: walletVal.data,
          uid,
          userInfo,
        });
        if (!walletResult.replay) {
          if (walletResult.receipt && walletResult.ledgerIds.length === 1) {
            try {
              await enqueueReceiptPaymentConfirmation(db, walletResult.receipt, {
                actorId: uid,
                operation: 'finance:receipts:create-and-post',
              });
            } catch (zaloErr) {
              console.error('[Finance] Zalo payment outbox enqueue failed:', zaloErr);
            }
          }
          await writeCriticalAuditLog(db, {
            userId: uid,
            userRole: userInfo.role,
            action: 'create',
            collection: 'receipts',
            documentId: walletResult.response.id,
            metadata: {
              action: 'wallet-manual-v2-create-and-post',
              receiptNo: walletResult.response.receiptNo,
              amount: walletVal.data.amountReceived,
              transactionGroupId: walletResult.response.transactionGroupId,
              ledgerIds: walletResult.ledgerIds,
              ...(walletResult.ledgerIds.length > 1
                ? { notificationSkippedReason: 'multiple_ledger_allocations' }
                : {}),
            },
            ip: getClientIp(req),
            userAgent: String(req.headers['user-agent'] || ''),
          });
          await refreshAccountingStudentSummariesAfterCommit(
            db,
            [walletVal.data.studentId],
            'wallet-manual-receipt-created',
            { actorId: uid, operation: 'finance:receipts:create-and-post' }
          );
          await touchRealtimeEvent('finance-receipt');
          await touchRealtimeEvent('finance-ledger');
          await touchRealtimeEvent('accounting-student-finance');
          await touchRealtimeEvent('accounting-students');
          await touchRealtimeEvent('parent-tuition', { targetId: walletVal.data.studentId });
        }
        return res.status(walletResult.replay ? 200 : 201).json(walletResult.response);
      }

      const val = validateBody(createReceiptSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }

      const studentId = val.data.studentId;
      const classId = val.data.classId;
      const ledgerId = val.data.ledgerId;
      const amountReceived = val.data.amountReceived;
      const discountType = val.data.discountType || 'none';

      const idempotencyRef = db
        .collection('finance_idempotency_keys')
        .doc(`${uid}:${idempotencyKey}`);
      const ledgerRef = db.collection('course_fee_ledgers').doc(ledgerId);
      const receiptRef = db.collection('receipts').doc();
      const { dateStr, prefix } = getDailyPrefix('receipt');

      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:receipts:create-and-post' },
        async (tx) => {
        const idempotencySnap = await tx.get(idempotencyRef);
        if (idempotencySnap.exists) {
          return {
            replay: true,
            response: idempotencySnap.data()?.response,
            receipt: null,
          };
        }

        const ledgerSnap = await tx.get(ledgerRef);
        if (!ledgerSnap.exists) throw validationError('Ledger not found');
        const ledger = ledgerSnap.data()!;
        if (
          String(ledger.studentId || '') !== studentId ||
          String(ledger.classId || '') !== classId
        ) {
          throw validationError('Receipt does not match ledger');
        }

        const siblingEligible = await loadSiblingEligibility(tx, db, studentId);
        const { receiptDiscount, siblingGrant, discountFields } = computeReceiptDiscount({
          ledger,
          body,
          discountType,
          amountReceived,
          siblingEligible,
          siblingClaimed: Boolean(body.siblingDiscount),
          siblingWaived: Boolean(body.siblingDiscountWaived),
          siblingWaivedReason: String(body.siblingDiscountWaivedReason || ''),
        });

        const activePaymentsQuery = db
          .collection('payment_requests')
          .where('ledgerId', '==', ledgerId)
          .where('status', 'in', ['creating_gateway_session', 'pending']);
        const activePaymentsSnap = await tx.get(activePaymentsQuery);

        const seq = await reserveNextCounterSequence(tx, db, {
          counterId: `receipts_${dateStr}`,
          collectionName: 'receipts',
          numberField: 'receiptNo',
          prefix,
        });
        const receiptNo = `${prefix}${String(seq).padStart(3, '0')}`;
        const now = new Date().toISOString();
        const receiptData = {
          receiptNo,
          type: 'tuition',
          studentId,
          classId,
          ledgerId,
          amountReceived,
          paymentMethod: String(body.paymentMethod || 'cash'),
          receivedDate: String(body.receivedDate || now.slice(0, 10)),
          createdBy: uid,
          createdByRole: userInfo.role,
          createdByName: userInfo.name,
          status: 'posted',
          note: String(body.note || ''),
          createdAt: now,
          updatedAt: now,
          ...discountFields,
        };
        const newPaidTotal = finiteMoney(ledger.paidTotal) + amountReceived;
        const newDiscountTotal = finiteMoney(ledger.discountTotal) + receiptDiscount;
        const newLedgerStatus = resolveLedgerStatus({
          amount: finiteMoney(ledger.amount),
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          isFullWaiver: discountType === 'full_waiver',
        });

        tx.set(receiptRef, receiptData);
        tx.update(ledgerRef, {
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          siblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal) + siblingGrant,
          status: newLedgerStatus,
          updatedAt: now,
        });
        for (const payDoc of activePaymentsSnap.docs || []) {
          tx.update(payDoc.ref, {
            status: 'stale',
            staleReason: 'manual_receipt_posted',
            accountingResolution: 'manual_receipt_posted_while_gateway_session_active',
            manualReceiptId: receiptRef.id,
            manualReceiptNo: receiptNo,
            manualReceiptAmount: amountReceived,
            manualReceiptPostedBy: uid,
            manualReceiptPostedAt: now,
            updatedAt: now,
          });
        }

        const response = {
          success: true,
          id: receiptRef.id,
          receiptNo,
          status: 'posted',
          newPaidTotal,
          newLedgerStatus,
          staledPayments: Number(activePaymentsSnap.size || 0),
        };
        tx.set(idempotencyRef, {
          type: 'receipt-create-and-post',
          uid,
          idempotencyKey,
          status: 'completed',
          response,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { replay: false, response, receipt: { id: receiptRef.id, ...receiptData } };
      });

      if (!result.replay) {
        try {
          await enqueueReceiptPaymentConfirmation(db, result.receipt || {}, {
            actorId: uid,
            operation: 'finance:receipts:create-and-post',
          });
        } catch (zaloErr) {
          console.error('[Finance] Zalo payment outbox enqueue failed:', zaloErr);
        }
        await writeCriticalAuditLog(db, {
          userId: uid,
          userRole: userInfo.role,
          action: 'create',
          collection: 'receipts',
          documentId: result.response.id,
          metadata: {
            action: 'create-and-post',
            receiptNo: result.response.receiptNo,
            amount: amountReceived,
            newPaidTotal: result.response.newPaidTotal,
          },
          ip: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
        });

        await refreshAccountingStudentSummariesAfterCommit(
          db,
          [studentId],
          'receipt-created-and-posted',
          { actorId: uid, operation: 'finance:receipts:create-and-post' }
        );

        await touchRealtimeEvent('finance-receipt');
        await touchRealtimeEvent('finance-ledger');
        await touchRealtimeEvent('accounting-student-finance');
        await touchRealtimeEvent('parent-tuition', { targetId: studentId });
      }

      return res.status(result.replay ? 200 : 201).json(result.response);
    } catch (err) {
      console.error('[Finance] Create-and-post receipt error:', err);
      const statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
      const knownErrorCode = (err as { errorCode?: string })?.errorCode;
      return res.status(statusCode).json({
        success: false,
        errorCode:
          knownErrorCode || (statusCode === 400 ? 'bad_request' : 'internal_error'),
        error:
          (statusCode === 400 || statusCode === 409) && err instanceof Error
            ? err.message
            : 'Failed to create and post receipt',
      });
    }
  }

  if (action === 'create' && req.method === 'POST') {
    try {
      const body = normalizeBody(req.body);
      const val = validateBody(createReceiptSchema, body);
      if (!val.success) {
        return res
          .status(400)
          .json({ success: false, error: (val as { success: false; error: string }).error });
      }
      const studentId = val.data.studentId;
      const classId = val.data.classId;
      const ledgerId = val.data.ledgerId;
      const amountReceived = val.data.amountReceived;
      const discountType = val.data.discountType || 'none';
      const receiptRef = db.collection('receipts').doc();
      const ledgerRef = db.collection('course_fee_ledgers').doc(ledgerId);
      const { dateStr, prefix } = getDailyPrefix('receipt');
      const validationError = (message: string) =>
        Object.assign(new Error(message), { statusCode: 400 });

      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:receipts:create' },
        async (tx) => {
        const ledgerSnap = await tx.get(ledgerRef);
        if (!ledgerSnap.exists) throw validationError('Ledger not found');
        const ledger = ledgerSnap.data()!;
        if (
          String(ledger.studentId || '') !== studentId ||
          String(ledger.classId || '') !== classId
        ) {
          throw validationError('Receipt does not match ledger');
        }
        const siblingEligible = await loadSiblingEligibility(tx, db, studentId);
        const { discountFields } = computeReceiptDiscount({
          ledger,
          body,
          discountType,
          amountReceived,
          siblingEligible,
          siblingClaimed: Boolean(body.siblingDiscount),
          siblingWaived: Boolean(body.siblingDiscountWaived),
          siblingWaivedReason: String(body.siblingDiscountWaivedReason || ''),
        });

        const seq = await reserveNextCounterSequence(tx, db, {
          counterId: `receipts_${dateStr}`,
          collectionName: 'receipts',
          numberField: 'receiptNo',
          prefix,
        });
        const receiptNo = `${prefix}${String(seq).padStart(3, '0')}`;
        const receiptData = {
          receiptNo,
          type: 'tuition',
          studentId,
          classId,
          ledgerId,
          amountReceived,
          paymentMethod: String(body.paymentMethod || 'cash'),
          receivedDate: String(body.receivedDate || ''),
          createdBy: uid,
          createdByRole: userInfo.role,
          createdByName: userInfo.name,
          status: 'draft',
          note: String(body.note || ''),
          createdAt: FieldValue.serverTimestamp(),
          ...discountFields,
        };
        tx.set(receiptRef, receiptData);
        return { receiptNo };
      });

      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        action: 'create',
        collection: 'receipts',
        documentId: receiptRef.id,
        metadata: { receiptNo: result.receiptNo, amount: amountReceived },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      await touchRealtimeEvent('finance-receipt');
      return res
        .status(201)
        .json({ success: true, id: receiptRef.id, receiptNo: result.receiptNo });
    } catch (err) {
      console.error('[Finance] Create receipt error:', err);
      const statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
      const knownErrorCode = (err as { errorCode?: string })?.errorCode;
      return res.status(statusCode).json({
        success: false,
        errorCode: knownErrorCode || (statusCode === 400 ? 'bad_request' : 'internal_error'),
        error:
          (statusCode === 400 || statusCode === 409) && err instanceof Error
            ? err.message
            : 'Failed to create receipt',
      });
    }
  }

  if (action === 'next-number' && req.method === 'GET') {
    try {
      return res.json({
        success: true,
        receiptNo: await previewReceiptNo(db),
        preview: true,
        reserved: false,
      });
    } catch (err) {
      console.error('[Finance] Next receipt number error:', err);
      return res.status(500).json({
        success: false,
        errorCode: 'internal_error',
        error: 'Failed to generate receipt number',
      });
    }
  }

  if (action === 'post' && req.method === 'POST') {
    if (!id) return res.status(400).json({ success: false, error: 'Missing receipt id' });
    try {
      const validationError = (message: string) =>
        Object.assign(new Error(message), { statusCode: 400 });
      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:receipts:post' },
        async (tx) => {
        const receiptRef = db.collection('receipts').doc(id);
        const receiptSnap = await tx.get(receiptRef);
        if (!receiptSnap.exists) throw validationError('Receipt not found');
        const receipt = receiptSnap.data()!;
        if (receipt.status !== 'draft') throw validationError('Only draft receipts can be posted');

        const ledgerRef = db.collection('course_fee_ledgers').doc(receipt.ledgerId);
        const ledgerSnap = await tx.get(ledgerRef);
        if (!ledgerSnap.exists) throw validationError('Ledger not found');
        const ledger = ledgerSnap.data()!;
        const invoiceId = String(receipt.invoiceId || '');
        const invoiceRef = invoiceId ? db.collection('invoices').doc(invoiceId) : null;
        const invoiceSnap = invoiceRef ? await tx.get(invoiceRef) : null;

        const siblingEligible = await loadSiblingEligibility(tx, db, String(receipt.studentId));
        const {
          siblingGrant,
          discountAmount: receiptDiscount,
          clamped,
        } = clampSiblingGrantForPost({
          eligible: siblingEligible,
          ledgerAmount: finiteMoney(ledger.amount),
          siblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal),
          receiptDiscountAmount: finiteMoney(receipt.discountAmount),
          receiptSiblingAmount: finiteMoney(receipt.siblingDiscountAmount),
        });

        const receiptAmount = finiteMoney(receipt.amountReceived);
        const remainingBeforeReceipt = ledgerRemaining(ledger);
        if (receipt.discountType === 'full_waiver') {
          if (receiptAmount !== 0)
            throw validationError('Full waiver cannot include a received amount');
          if (receiptDiscount !== remainingBeforeReceipt) {
            throw validationError('Full waiver discount must match remaining tuition');
          }
        } else {
          if (receiptAmount <= 0) throw validationError('Receipt amount must be greater than zero');
          if (receiptDiscount < 0 || receiptDiscount > remainingBeforeReceipt) {
            throw validationError('Invalid receipt discount amount');
          }
        }
        if (receiptAmount > Math.max(0, remainingBeforeReceipt - receiptDiscount)) {
          throw validationError('Receipt amount exceeds remaining tuition');
        }

        // Read active payment requests INSIDE the transaction (before writes)
        const activeStatuses = ['creating_gateway_session', 'pending'];
        const activePaymentsQuery = db
          .collection('payment_requests')
          .where('ledgerId', '==', receipt.ledgerId)
          .where('status', 'in', activeStatuses);
        const activePaymentsSnap = await tx.get(activePaymentsQuery);

        const newPaidTotal = finiteMoney(ledger.paidTotal) + receiptAmount;
        const newDiscountTotal = finiteMoney(ledger.discountTotal) + receiptDiscount;
        const newLedgerStatus = resolveLedgerStatus({
          amount: finiteMoney(ledger.amount),
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          isFullWaiver: receipt.discountType === 'full_waiver',
        });

        // All writes in one atomic batch
        const now = new Date().toISOString();
        tx.update(receiptRef, {
          status: 'posted',
          updatedAt: now,
          ...(clamped
            ? {
                discountAmount: receiptDiscount,
                ...(siblingGrant > 0
                  ? { siblingDiscountAmount: siblingGrant }
                  : {
                      siblingDiscountAmount: FieldValue.delete(),
                      siblingDiscount: FieldValue.delete(),
                    }),
              }
            : {}),
        });
        tx.update(ledgerRef, {
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          siblingDiscountTotal: finiteMoney(ledger.siblingDiscountTotal) + siblingGrant,
          status: newLedgerStatus,
          updatedAt: now,
        });
        if (invoiceRef && invoiceSnap?.exists) {
          const invoice = invoiceSnap.data() || {};
          const invoicePaidTotal = finiteMoney(invoice.amountPaid) + receiptAmount;
          const invoiceAmount = finiteMoney(invoice.amountDue);
          const invoicePaid = invoiceAmount > 0 && invoicePaidTotal >= invoiceAmount;
          tx.update(invoiceRef, {
            amountPaid: invoicePaidTotal,
            status: invoicePaid ? 'paid' : 'partially_paid',
            receiptId: id,
            ...(invoicePaid ? { paidAt: now } : {}),
            updatedAt: now,
          });
        }

        // Stale active PayOS sessions atomically with receipt posting
        for (const payDoc of activePaymentsSnap.docs) {
          tx.update(payDoc.ref, {
            status: 'stale',
            staleReason: 'manual_receipt_posted',
            accountingResolution: 'manual_receipt_posted_while_gateway_session_active',
            manualReceiptId: id,
            manualReceiptNo: String(receipt.receiptNo || ''),
            manualReceiptAmount: receiptAmount,
            manualReceiptPostedBy: uid,
            manualReceiptPostedAt: now,
            updatedAt: now,
          });
        }

        return {
          newPaidTotal,
          newLedgerStatus,
          receipt: { id, ...receipt },
          staledPayments: activePaymentsSnap.size,
        };
      });

      if (result.staledPayments > 0) {
        console.log(
          `[Finance] Staled ${result.staledPayments} active payment(s) atomically with receipt post`
        );
      }

      try {
        await enqueueReceiptPaymentConfirmation(db, result.receipt, {
          actorId: uid,
          operation: 'finance:receipts:post',
        });
      } catch (zaloErr) {
        console.error('[Finance] Zalo payment outbox enqueue failed:', zaloErr);
      }

      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        action: 'update',
        collection: 'receipts',
        documentId: id,
        metadata: {
          action: 'post',
          newPaidTotal: result.newPaidTotal,
          newLedgerStatus: result.newLedgerStatus,
        },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });
      const postedStudentId = String((result.receipt as Record<string, unknown>)?.studentId || '');
      await refreshAccountingStudentSummariesAfterCommit(
        db,
        postedStudentId ? [postedStudentId] : [],
        'receipt-posted',
        { actorId: uid, operation: 'finance:receipts:post' }
      );
      await touchRealtimeEvent('finance-receipt');
      await touchRealtimeEvent('finance-ledger');
      await touchRealtimeEvent('accounting-student-finance');
      if ((result.receipt as Record<string, unknown>)?.studentId) {
        await touchRealtimeEvent('parent-tuition', {
          targetId: String((result.receipt as Record<string, unknown>).studentId),
        });
      }
      const { receipt: _receipt, ...response } = result;
      return res.json({ success: true, ...response });
    } catch (err) {
      console.error('[Finance] Post receipt error:', err);
      const statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
      return res.status(statusCode).json({
        success: false,
        errorCode: statusCode === 400 ? 'bad_request' : 'internal_error',
        error: statusCode === 400 && err instanceof Error ? err.message : 'Failed to post receipt',
      });
    }
  }

  if (action === 'void' && req.method === 'POST') {
    if (!id) return res.status(400).json({ success: false, error: 'Missing receipt id' });
    try {
      const validationError = (message: string) =>
        Object.assign(new Error(message), { statusCode: 400 });
      const body = normalizeBody(req.body);
      const receiptPreviewRef = db.collection('receipts').doc(id);
      const receiptPreviewSnap = await receiptPreviewRef.get();
      if (!receiptPreviewSnap.exists) throw validationError('Receipt not found');
      const receiptPreview = receiptPreviewSnap.data() || {};
      if (receiptPreview.flowVersion === 'wallet-manual-v2') {
        const walletVoidVal = validateBody(voidFinanceMutationSchema, body);
        if (!walletVoidVal.success) {
          return res.status(400).json({
            success: false,
            error: (walletVoidVal as { success: false; error: string }).error,
          });
        }
        const walletVoidResult = await voidWalletManualReceipt({
          db,
          receiptId: id,
          idempotencyKey: walletVoidVal.data.idempotencyKey,
          reason: walletVoidVal.data.reason,
          uid,
          userInfo,
        });
        if (!walletVoidResult.replay) {
          await writeCriticalAuditLog(db, {
            userId: uid,
            userRole: userInfo.role,
            userName: userInfo.name,
            action: 'update',
            collection: 'receipts',
            documentId: id,
            metadata: {
              action: 'wallet-manual-v2-void',
              reason: walletVoidVal.data.reason,
              transactionGroupId: receiptPreview.transactionGroupId || '',
              newBalance: walletVoidResult.response.newBalance,
            },
            ip: getClientIp(req),
            userAgent: String(req.headers['user-agent'] || ''),
          });
          const studentId = String(receiptPreview.studentId || '');
          await refreshAccountingStudentSummariesAfterCommit(
            db,
            studentId ? [studentId] : [],
            'wallet-manual-receipt-voided',
            { actorId: uid, operation: 'finance:receipts:void' }
          );
          await touchRealtimeEvent('finance-receipt');
          await touchRealtimeEvent('finance-ledger');
          await touchRealtimeEvent('accounting-student-finance');
          await touchRealtimeEvent('accounting-students');
          if (studentId) {
            await touchRealtimeEvent('parent-tuition', { targetId: studentId });
          }
        }
        return res.json(walletVoidResult.response);
      }
      const voidReason = String(body.voidReason || body.reason || 'Voided by accountant').trim();
      const result = await runStudentIdentityMutationTransaction(
        db,
        { actorId: uid, operation: 'finance:receipts:void' },
        async (tx) => {
        const receiptRef = db.collection('receipts').doc(id);
        const receiptSnap = await tx.get(receiptRef);
        if (!receiptSnap.exists) throw validationError('Receipt not found');
        const receipt = receiptSnap.data()!;
        if (receipt.status !== 'posted')
          throw validationError('Only posted receipts can be voided');
        if (receipt.walletDeposit === true) {
          throw validationError(
            'Wallet top-up receipts must be voided from the Student Wallets tab, not here'
          );
        }

        const ledgerRef = db.collection('course_fee_ledgers').doc(receipt.ledgerId);
        const ledgerSnap = await tx.get(ledgerRef);
        if (!ledgerSnap.exists) throw validationError('Ledger not found');
        const ledger = ledgerSnap.data()!;
        const invoiceId = String(receipt.invoiceId || '');
        const invoiceRef = invoiceId ? db.collection('invoices').doc(invoiceId) : null;
        const invoiceSnap = invoiceRef ? await tx.get(invoiceRef) : null;

        const receiptDiscount = finiteMoney(receipt.discountAmount);
        const newPaidTotal = Math.max(
          0,
          finiteMoney(ledger.paidTotal) - finiteMoney(receipt.amountReceived)
        );
        const newDiscountTotal = Math.max(0, finiteMoney(ledger.discountTotal) - receiptDiscount);
        const newSiblingDiscountTotal = Math.max(
          0,
          finiteMoney(ledger.siblingDiscountTotal) - finiteMoney(receipt.siblingDiscountAmount)
        );
        const newLedgerStatus = resolveLedgerStatus({
          amount: finiteMoney(ledger.amount),
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          requirePositiveEffective: true,
        });

        const now = new Date().toISOString();
        tx.update(receiptRef, {
          status: 'void',
          voidReason,
          voidedAt: now,
          voidedBy: uid,
          voidedByName: userInfo.name,
          updatedAt: now,
        });
        tx.update(ledgerRef, {
          paidTotal: newPaidTotal,
          discountTotal: newDiscountTotal,
          siblingDiscountTotal: newSiblingDiscountTotal,
          status: newLedgerStatus,
          updatedAt: now,
        });
        if (receipt.paymentRequestId) {
          tx.update(db.collection('payment_requests').doc(String(receipt.paymentRequestId)), {
            status: 'manually_voided',
            receiptStatus: 'void',
            accountingResolution: 'receipt_voided_manual_handling',
            voidedAt: now,
            voidedBy: uid,
            voidedByName: userInfo.name,
            voidReason,
            updatedAt: now,
          });
        }
        if (invoiceRef && invoiceSnap?.exists) {
          const invoice = invoiceSnap.data() || {};
          const invoicePaidTotal = Math.max(
            0,
            finiteMoney(invoice.amountPaid) - finiteMoney(receipt.amountReceived)
          );
          const invoiceAmount = finiteMoney(invoice.amountDue);
          tx.update(invoiceRef, {
            amountPaid: invoicePaidTotal,
            status:
              invoicePaidTotal <= 0
                ? 'issued'
                : invoiceAmount > 0 && invoicePaidTotal >= invoiceAmount
                  ? 'paid'
                  : 'partially_paid',
            voidedReceiptId: id,
            updatedAt: now,
          });
        }

        return {
          newPaidTotal,
          newLedgerStatus,
          paymentRequestId: receipt.paymentRequestId || '',
          studentId: receipt.studentId || '',
        };
      });

      await writeCriticalAuditLog(db, {
        userId: uid,
        userRole: userInfo.role,
        userName: userInfo.name,
        action: 'update',
        collection: 'receipts',
        documentId: id,
        metadata: { action: 'void', voidReason, ...result },
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
      });

      await refreshAccountingStudentSummariesAfterCommit(
        db,
        result.studentId ? [result.studentId] : [],
        'receipt-voided',
        { actorId: uid, operation: 'finance:receipts:void' }
      );

      await touchRealtimeEvent('finance-receipt');
      await touchRealtimeEvent('finance-ledger');
      await touchRealtimeEvent('accounting-student-finance');
      if (result.studentId) {
        await touchRealtimeEvent('parent-tuition', { targetId: result.studentId });
      }

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[Finance] Void receipt error:', err);
      const statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
      const knownErrorCode = (err as { errorCode?: string })?.errorCode;
      return res.status(statusCode).json({
        success: false,
        errorCode:
          knownErrorCode ||
          (statusCode === 400 ? 'bad_request' : statusCode === 409 ? 'conflict' : 'internal_error'),
        error:
          (statusCode === 400 || statusCode === 409) && err instanceof Error
            ? err.message
            : 'Failed to void receipt',
      });
    }
  }

  return res.status(404).json({ success: false, error: 'Unknown receipt action' });
}
