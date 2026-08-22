import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { writeCriticalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { reserveInvoiceForPayment } from '../../lib/services/invoiceService.js';
import { ledgerRemaining } from './shared.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';

function invoiceDoc(
  doc: AppDocumentStore.QueryDocumentSnapshot | AppDocumentStore.DocumentSnapshot
) {
  return { id: doc.id, ...(doc.data() || {}) };
}

export async function handleInvoices(
  req: ApiRequest,
  res: ApiResponse,
  id: string,
  action: string,
  uid: string,
  userInfo: { role: string; name: string }
) {
  const db = getDb();

  if (!id && action === 'list' && req.method === 'GET') {
    let query: AppDocumentStore.Query = db.collection('invoices').orderBy('createdAt', 'desc');
    const ledgerId = typeof req.query.ledgerId === 'string' ? req.query.ledgerId.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (ledgerId) query = query.where('ledgerId', '==', ledgerId);
    if (status) query = query.where('status', '==', status);
    const snap = await query.limit(2000).get();
    return res.status(200).json({ success: true, invoices: snap.docs.map(invoiceDoc) });
  }

  if (id && (!action || action === 'get') && req.method === 'GET') {
    const snap = await db.collection('invoices').doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Invoice not found' });
    return res.status(200).json({ success: true, invoice: invoiceDoc(snap) });
  }

  if (action === 'create' && req.method === 'POST') {
    const body = normalizeBody(req.body);
    const ledgerId = String(body.ledgerId || '').trim();
    if (!ledgerId) return res.status(400).json({ success: false, error: 'Missing ledgerId' });

    const invoice = await runStudentIdentityMutationTransaction(
      db,
      { actorId: uid, operation: 'finance:invoices:create' },
      async (tx) => {
      const ledgerRef = db.collection('course_fee_ledgers').doc(ledgerId);
      const ledgerSnap = await tx.get(ledgerRef);
      if (!ledgerSnap.exists) {
        throw Object.assign(new Error('Ledger not found'), { statusCode: 404 });
      }
      const ledger = ledgerSnap.data() || {};
      const amountDue = ledgerRemaining(ledger);
      if (amountDue <= 0) {
        throw Object.assign(new Error('Ledger has no outstanding tuition'), { statusCode: 400 });
      }

      const studentId = String(ledger.studentId || '');
      const classId = String(ledger.classId || '');
      const [studentSnap, classSnap] = await Promise.all([
        studentId ? tx.get(db.collection('students').doc(studentId)) : null,
        classId ? tx.get(db.collection('classes').doc(classId)) : null,
      ]);

      return reserveInvoiceForPayment(tx, db, {
        ledgerId,
        studentId,
        classId,
        amountDue,
        ledger,
        studentName: String(studentSnap?.data()?.name || ''),
        className: String(classSnap?.data()?.name || ''),
      });
    });

    await writeCriticalAuditLog(db, {
      userId: uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'create',
      collection: 'invoices',
      documentId: invoice.invoiceId,
      metadata: { invoiceNo: invoice.invoiceNo, ledgerId, amountDue: invoice.amountDue },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    return res.status(invoice.created ? 201 : 200).json({ success: true, invoice });
  }

  return res.status(404).json({ success: false, error: 'Unknown invoice action' });
}
