import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { writeAuditLog, getClientIp } from '../../../lib/logging/auditLog.js';
import { normalizeBody } from '../../../lib/http/helpers.js';
import { createLogger } from '../../../lib/logging/logger.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import {
  FieldValue,
  getNextPayOSOrderCode,
  getRemainingTuition,
} from '../../../lib/payments/tuitionPayments.js';
import { enforceRateLimit } from '../../../lib/auth/rateLimit.js';
import { getDb, verifyAuthContext } from '../../../lib/auth/verifyAuth.js';
import { authUserFromContext, mutationUserInfoFromContext } from '../../../lib/auth/contextUser.js';
import {
  ACTIVE_PAYMENT_STATUSES,
  hashText,
  getRequiredEnv,
  PAYMENT_CREATE_FAILED_REASON,
  PAYMENT_SESSION_TTL_MS,
  type PaymentStatus,
} from './shared.js';
import {
  reserveInvoiceForPayment,
  type InvoiceReservation,
} from '../../../lib/services/invoiceService.js';
import { runStudentIdentityMutationTransaction } from '../../../lib/maintenance/studentIdentityMutationTransaction.js';

const logger = createLogger('payOS-create');

export async function handleCreate(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['parent']);
  if (!verified) return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = mutationUserInfoFromContext(verified.context);

  if (
    !(await enforceRateLimit(db, req, res, {
      scope: 'payos_create',
      uid: user.uid,
      maxAttempts: 12,
      windowMs: 60 * 1000,
      message: 'Too many payment link requests',
    }))
  ) {
    return;
  }

  const body = normalizeBody(req.body);
  const ledgerId = String(body.ledgerId || '').trim();
  if (!ledgerId) return res.status(400).json({ success: false, error: 'Missing ledgerId' });

  const parentStudentId = String(verified.context.studentId || '');
  if (!parentStudentId) {
    return res.status(403).json({ success: false, error: 'Parent account is not linked' });
  }

  // Rate limit: max 5 active payment sessions per parent
  const activeSessionsSnap = await db
    .collection('payment_requests')
    .where('parentUid', '==', user.uid)
    .where('status', 'in', ['creating_gateway_session', 'pending'])
    .limit(6)
    .get();
  if (activeSessionsSnap.size >= 5) {
    return res.status(429).json({
      success: false,
      error:
        'Too many active payment sessions. Please complete or wait for existing sessions to expire.',
    });
  }

  const ledgerRef = db.collection('course_fee_ledgers').doc(ledgerId);
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) {
    return res.status(404).json({ success: false, error: 'Tuition ledger not found' });
  }
  const ledger = ledgerSnap.data()!;
  if (String(ledger.studentId || '') !== parentStudentId) {
    return res.status(403).json({ success: false, error: 'Not authorized for this tuition' });
  }

  const amount = getRemainingTuition(ledger);
  if (amount <= 0) {
    return res.status(400).json({ success: false, error: 'This tuition is already paid' });
  }

  logger.info('Creating payOS payment', { ledgerId, amount, parentUid: user.uid });

  const studentSnap = await db.collection('students').doc(parentStudentId).get();
  const classId = String(ledger.classId || '');
  const classSnap = classId ? await db.collection('classes').doc(classId).get() : null;
  const student = studentSnap.data() || {};
  const cls = classSnap?.data() || {};

  let orderCode: number;
  try {
    orderCode = await getNextPayOSOrderCode(db);
  } catch (err) {
    logger.error('Failed to generate order code', { error: err });
    throw err;
  }

  let returnUrl: string;
  let cancelUrl: string;
  try {
    returnUrl = getRequiredEnv('PAYOS_RETURN_URL');
    cancelUrl = getRequiredEnv('PAYOS_CANCEL_URL');
  } catch (err) {
    logger.error('Missing PayOS env vars', {
      hasReturnUrl: !!process.env.PAYOS_RETURN_URL,
      hasCancelUrl: !!process.env.PAYOS_CANCEL_URL,
      hasClientId: !!process.env.PAYOS_CLIENT_ID,
      hasApiKey: !!process.env.PAYOS_API_KEY,
      hasChecksumKey: !!process.env.PAYOS_CHECKSUM_KEY,
    });
    throw err;
  }

  const description = `Học phí ${orderCode}`.slice(0, 25);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAYMENT_SESSION_TTL_MS).toISOString();

  let reservation: Awaited<ReturnType<typeof reservePaymentIntent>>;
  try {
    reservation = await reservePaymentIntent(db, {
      ledgerId,
      parentUid: user.uid,
      studentId: parentStudentId,
      classId,
      amount,
      orderCode,
      returnUrl,
      cancelUrl,
      description,
      studentName: String(student.name || ''),
      className: String(cls.name || ''),
      expiresAt,
    });
  } catch (err) {
    logger.error('Failed to reserve payment intent', { error: err, ledgerId, orderCode });
    throw err;
  }

  if (reservation.kind === 'reusable') {
    return res.status(200).json({
      success: true,
      checkoutUrl: reservation.payment.checkoutUrl,
      orderCode: reservation.payment.orderCode,
      paymentRequestId: reservation.payment.id,
      amount: reservation.payment.amount,
      invoiceId: reservation.payment.invoiceId || '',
      invoiceNo: reservation.payment.invoiceNo || '',
      returnUrl: reservation.payment.returnUrl,
      status: reservation.payment.status,
    });
  }

  if (reservation.kind === 'initializing') {
    return res.status(409).json({
      success: false,
      error: 'Payment session is still being initialized. Please retry in a few seconds.',
    });
  }

  const paymentRef = db.collection('payment_requests').doc(reservation.paymentId);
  // Use the amount confirmed by the transaction (may differ from stale pre-read amount)
  const confirmedAmount = reservation.amount;

  logger.info('Calling PayOS API', { orderCode, amount: confirmedAmount });

  let paymentLink: Awaited<
    ReturnType<ReturnType<typeof getPayOSClient>['paymentRequests']['create']>
  >;
  try {
    paymentLink = await getPayOSClient().paymentRequests.create({
      orderCode,
      amount: confirmedAmount,
      description,
      returnUrl,
      cancelUrl,
      items: [
        {
          name: `Học phí ${String(student.name || 'học viên')}`.slice(0, 100),
          quantity: 1,
          price: confirmedAmount,
        },
      ],
      buyerName: String(student.name || ''),
      buyerPhone: String(student.contact || ''),
      expiredAt: Math.floor(new Date(expiresAt).getTime() / 1000),
    });
  } catch (err) {
    logger.error('Failed to create payOS payment link', {
      paymentRequestId: reservation.paymentId,
      orderCode,
      error: err instanceof Error ? err.message : String(err),
    });
    await paymentRef.set(
      {
        status: 'create_failed' satisfies PaymentStatus,
        failureReason: PAYMENT_CREATE_FAILED_REASON,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await clearPaymentLock(db, ledgerId, user.uid, reservation.paymentId);
    throw err;
  }

  await paymentRef.set(
    {
      status: 'pending' satisfies PaymentStatus,
      checkoutUrl: paymentLink.checkoutUrl,
      paymentLinkId: paymentLink.paymentLinkId,
      qrCode: paymentLink.qrCode || '',
      gatewayStatus: paymentLink.status || '',
      nextReconcileAt: FieldValue.serverTimestamp(),
      reconcileAttempts: 0,
      lastReconciledAt: null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  void writeAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'create',
    collection: 'payment_requests',
    documentId: reservation.paymentId,
    metadata: {
      provider: 'payos',
      orderCode,
      ledgerId,
      invoiceId: reservation.invoice.invoiceId,
      invoiceNo: reservation.invoice.invoiceNo,
      amount: confirmedAmount,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });

  return res.status(201).json({
    success: true,
    checkoutUrl: paymentLink.checkoutUrl,
    orderCode,
    paymentRequestId: reservation.paymentId,
    amount: confirmedAmount,
    invoiceId: reservation.invoice.invoiceId,
    invoiceNo: reservation.invoice.invoiceNo,
    returnUrl,
    status: 'pending',
  });
}

async function reservePaymentIntent(
  db: AppDocumentStore.DocumentStore,
  input: {
    ledgerId: string;
    parentUid: string;
    studentId: string;
    classId: string;
    amount: number;
    orderCode: number;
    returnUrl: string;
    cancelUrl: string;
    description: string;
    studentName: string;
    className: string;
    expiresAt: string;
  }
): Promise<
  | { kind: 'new'; paymentId: string; amount: number; invoice: InvoiceReservation }
  | { kind: 'reusable'; payment: Record<string, any> & { id: string } }
  | { kind: 'initializing' }
> {
  const lockRef = db
    .collection('_payment_locks')
    .doc(`${input.ledgerId}_${hashText(input.parentUid).slice(0, 16)}`);
  const paymentRef = db.collection('payment_requests').doc();
  const orderCodeRef = db.collection('payment_order_codes').doc(String(input.orderCode));
  const now = new Date();

  return runStudentIdentityMutationTransaction(
    db,
    { actorId: input.parentUid, operation: 'payments:create' },
    async (tx) => {
      // DocumentStore requires ALL reads before ANY writes
      const lockSnap = await tx.get(lockRef);
      const activePaymentId = lockSnap.exists ? String(lockSnap.data()?.activePaymentId || '') : '';

      // Read active payment and ledger upfront (before any writes)
      const ledgerRef = db.collection('course_fee_ledgers').doc(input.ledgerId);
      let activeRef: AppDocumentStore.DocumentReference | null = null;
      let activeSnap: AppDocumentStore.DocumentSnapshot | null = null;
      let ledgerSnap: AppDocumentStore.DocumentSnapshot | null = null;

      const reads: Promise<void>[] = [];
      if (activePaymentId) {
        activeRef = db.collection('payment_requests').doc(activePaymentId);
        reads.push(
          tx.get(activeRef).then((snap) => {
            activeSnap = snap;
          })
        );
      }
      reads.push(
        tx.get(ledgerRef).then((snap) => {
          ledgerSnap = snap;
        })
      );
      await Promise.all(reads);

      if (!ledgerSnap?.exists) {
        throw Object.assign(new Error('Tuition ledger not found'), { statusCode: 404 });
      }

      let staleActivePayment: {
        ref: AppDocumentStore.DocumentReference;
        patch: Record<string, unknown>;
      } | null = null;

      // Validate active payment (using pre-read data)
      if (activeRef && activeSnap?.exists) {
        const active = activeSnap.data()!;
        const activeStatus = String(active.status || '') as PaymentStatus;
        const activeExpiresAt = Date.parse(String(active.expiresAt || ''));
        const activeExpired = Number.isFinite(activeExpiresAt) && activeExpiresAt <= now.getTime();

        if (
          ACTIVE_PAYMENT_STATUSES.has(activeStatus) &&
          Number(active.amount || 0) === input.amount &&
          !activeExpired
        ) {
          if (active.checkoutUrl && active.paymentLinkId) {
            return { kind: 'reusable' as const, payment: { id: activeSnap.id, ...active } };
          }
          return { kind: 'initializing' as const };
        }

        if (ACTIVE_PAYMENT_STATUSES.has(activeStatus)) {
          staleActivePayment = {
            ref: activeRef,
            patch: {
              status: activeExpired ? 'expired' : 'stale',
              updatedAt: now.toISOString(),
              staleReason: activeExpired ? 'Payment session expired' : 'Tuition amount changed',
            },
          };
        }
      }

      // Validate ledger amount (using pre-read data)
      const freshRemaining = getRemainingTuition(ledgerSnap!.data()!);
      if (freshRemaining <= 0) {
        throw Object.assign(new Error('This tuition is already paid'), { statusCode: 400 });
      }
      const paymentAmount = freshRemaining;
      const invoice = await reserveInvoiceForPayment(tx, db, {
        ledgerId: input.ledgerId,
        studentId: input.studentId,
        classId: input.classId,
        parentUid: input.parentUid,
        orderCode: input.orderCode,
        amountDue: paymentAmount,
        ledger: ledgerSnap!.data()!,
        studentName: input.studentName,
        className: input.className,
        now,
      });

      if (staleActivePayment) {
        tx.update(staleActivePayment.ref, staleActivePayment.patch);
      }

      tx.create(orderCodeRef, {
        orderCode: input.orderCode,
        paymentRequestId: paymentRef.id,
        ledgerId: input.ledgerId,
        studentId: input.studentId,
        classId: input.classId,
        parentUid: input.parentUid,
        amount: paymentAmount,
        provider: 'payos',
        status: 'reserved',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: now.toISOString(),
      });
      tx.set(paymentRef, {
        orderCode: input.orderCode,
        ledgerId: input.ledgerId,
        studentId: input.studentId,
        classId: input.classId,
        parentUid: input.parentUid,
        amount: paymentAmount,
        currency: 'VND',
        provider: 'payos',
        status: 'creating_gateway_session' satisfies PaymentStatus,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        description: input.description,
        studentName: input.studentName,
        className: input.className,
        invoiceId: invoice.invoiceId,
        invoiceNo: invoice.invoiceNo,
        invoiceAmountSnapshot: invoice.amountDue,
        invoiceSnapshotVersion: invoice.snapshotVersion,
        expiresAt: input.expiresAt,
        nextReconcileAt: FieldValue.serverTimestamp(),
        reconcileAttempts: 0,
        lastReconciledAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: now.toISOString(),
      });
      tx.set(
        lockRef,
        {
          activePaymentId: paymentRef.id,
          ledgerId: input.ledgerId,
          parentUid: input.parentUid,
          amount: paymentAmount,
          updatedAt: now.toISOString(),
        },
        { merge: true }
      );

      return { kind: 'new' as const, paymentId: paymentRef.id, amount: paymentAmount, invoice };
    }
  );
}

async function clearPaymentLock(
  db: AppDocumentStore.DocumentStore,
  ledgerId: string,
  parentUid: string,
  paymentId: string
) {
  const lockRef = db
    .collection('_payment_locks')
    .doc(`${ledgerId}_${hashText(parentUid).slice(0, 16)}`);
  const snap = await lockRef.get();
  if (snap.exists && String(snap.data()?.activePaymentId || '') === paymentId) {
    await lockRef.set(
      {
        activePaymentId: '',
        clearedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }
}
