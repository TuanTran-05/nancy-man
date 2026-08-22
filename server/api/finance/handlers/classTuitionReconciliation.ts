import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import { isCanonicalTermStart } from '../../../../shared/classTuitionReconciliation.js';
import {
  buildClassReconciliationOptions,
  buildClassTuitionReconciliationReport,
  buildClassTuitionStudentDetail,
  ClassReconciliationNotFoundError,
  ClassReconciliationInvalidInputError,
} from '../../lib/services/classTuitionReconciliationService.js';
import { ClassReconciliationTooLargeError } from '../../lib/repositories/classTuitionReconciliationRepository.js';

export async function handleClassReconciliationOptions(
  req: ApiRequest,
  res: ApiResponse
): Promise<ApiResponse> {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return res;

  const db = getDb();
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;

  try {
    const data = await buildClassReconciliationOptions(db, { classId });
    return res.json(data);
  } catch (err: any) {
    if (
      err instanceof ClassReconciliationInvalidInputError ||
      err?.errorCode === 'class_reconciliation_invalid_request'
    ) {
      return res.status(400).json({
        success: false,
        errorCode: 'class_reconciliation_invalid_request',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationNotFoundError ||
      err?.errorCode === 'class_reconciliation_not_found'
    ) {
      return res.status(404).json({
        success: false,
        errorCode: 'class_reconciliation_not_found',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationTooLargeError ||
      err?.errorCode === 'class_reconciliation_too_large'
    ) {
      return res.status(413).json({
        success: false,
        errorCode: 'class_reconciliation_too_large',
        error: err.message,
      });
    }
    throw err;
  }
}

export async function handleClassReconciliation(
  req: ApiRequest,
  res: ApiResponse
): Promise<ApiResponse> {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return res;

  const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
  const termStart = typeof req.query.termStart === 'string' ? req.query.termStart : '';

  if (!classId || !isCanonicalTermStart(termStart)) {
    return res.status(400).json({
      success: false,
      errorCode: 'class_reconciliation_invalid_request',
      error: 'Valid classId and canonical termStart (YYYY-MM-DD) are required',
    });
  }

  const db = getDb();

  try {
    const data = await buildClassTuitionReconciliationReport(db, { classId, termStart });
    return res.json(data);
  } catch (err: any) {
    if (
      err instanceof ClassReconciliationInvalidInputError ||
      err?.errorCode === 'class_reconciliation_invalid_request'
    ) {
      return res.status(400).json({
        success: false,
        errorCode: 'class_reconciliation_invalid_request',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationNotFoundError ||
      err?.errorCode === 'class_reconciliation_not_found'
    ) {
      return res.status(404).json({
        success: false,
        errorCode: 'class_reconciliation_not_found',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationTooLargeError ||
      err?.errorCode === 'class_reconciliation_too_large'
    ) {
      return res.status(413).json({
        success: false,
        errorCode: 'class_reconciliation_too_large',
        error: err.message,
      });
    }
    throw err;
  }
}

export async function handleClassReconciliationStudent(
  req: ApiRequest,
  res: ApiResponse
): Promise<ApiResponse> {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await verifyAuthToken(req, res, ['admin', 'accounting']);
  if (!user) return res;

  const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
  const termStart = typeof req.query.termStart === 'string' ? req.query.termStart : '';
  const studentId =
    typeof req.query.studentId === 'string' && req.query.studentId.trim() !== ''
      ? req.query.studentId.trim()
      : undefined;
  const ledgerId =
    typeof req.query.ledgerId === 'string' && req.query.ledgerId.trim() !== ''
      ? req.query.ledgerId.trim()
      : undefined;

  const hasStudentId = Boolean(studentId);
  const hasLedgerId = Boolean(ledgerId);

  if (!classId || !isCanonicalTermStart(termStart) || hasStudentId === hasLedgerId) {
    return res.status(400).json({
      success: false,
      errorCode: 'class_reconciliation_invalid_request',
      error: 'Valid classId, termStart, and exactly one of studentId or ledgerId are required',
    });
  }

  const db = getDb();

  try {
    const data = await buildClassTuitionStudentDetail(db, {
      classId,
      termStart,
      studentId,
      ledgerId,
    });
    return res.json(data);
  } catch (err: any) {
    if (
      err instanceof ClassReconciliationInvalidInputError ||
      err?.errorCode === 'class_reconciliation_invalid_request'
    ) {
      return res.status(400).json({
        success: false,
        errorCode: 'class_reconciliation_invalid_request',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationNotFoundError ||
      err?.errorCode === 'class_reconciliation_not_found'
    ) {
      return res.status(404).json({
        success: false,
        errorCode: 'class_reconciliation_not_found',
        error: err.message,
      });
    }
    if (
      err instanceof ClassReconciliationTooLargeError ||
      err?.errorCode === 'class_reconciliation_too_large'
    ) {
      return res.status(413).json({
        success: false,
        errorCode: 'class_reconciliation_too_large',
        error: err.message,
      });
    }
    throw err;
  }
}
