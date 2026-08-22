import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { verifyAuthContext, getDb } from '../lib/auth/verifyAuth.js';
import { enforceRateLimit } from '../lib/auth/rateLimit.js';
import { sendApiError } from '../lib/http/helpers.js';
import {
  handleCreate,
  handleUpdate,
  handleStatus,
  handleDelete,
} from './handlers/classCrudHandlers.js';
import {
  handleImportStudents,
  handleUpdateSalary,
  handleResetCourse,
  handleGenerateLedgers,
  handleRebuildStudentCounts,
  handleSaveSettings,
  handleSaveHolidays,
} from './handlers/classOperationsHandlers.js';
import {
  handleCreateSubstituteRequest,
  handleAcceptSubstituteRequest,
  handleCancelSubstituteRequest,
} from './handlers/classSubstituteHandlers.js';
import {
  handleReviewAvailabilityChange,
  handleSaveAvailability,
  handleSaveAvailabilitySlot,
} from './handlers/classAvailabilityHandlers.js';
import {
  handleCancelPrintRequest,
  handleUpdatePrintRequestStatus,
} from './handlers/classPrintRequestHandlers.js';
import {
  handleApproveCourseClosing,
  handleCourseClosingStatus,
  handleExemptCourseClosingStudent,
} from './handlers/courseClosingHandlers.js';
import {
  handleCourseClosingRecordFile,
  handleCourseClosingRecordMonth,
  handleCourseClosingRecords,
} from './handlers/courseClosingRecordHandlers.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;

    const verified = await verifyAuthContext(req, res, [
      'admin',
      'teacher',
      'accounting',
      'office',
    ]);
    if (!verified) return;

    const user = verified.decoded;
    const db = getDb();

    // See `students/[action].ts`: early refusal only.
    if (await guardStudentIdentityRouteMutation(() => db, res, { surface: 'classes', action, req }))
      return;
    const userInfo = {
      uid: user.uid,
      role: verified.context.role,
      name: verified.context.name,
      displayName: verified.context.name,
    };
    const isCourseClosingRecordAssetRead =
      req.method === 'GET' && action === 'course-closing-record-file';
    if (isCourseClosingRecordAssetRead) {
      if (
        !(await enforceRateLimit(db, req, res, {
          scope: 'course_closing_record_file',
          uid: user.uid,
          action,
          maxAttempts: 60,
          windowMs: 60 * 1000,
          message: 'Too many archived file requests',
        }))
      ) {
        return;
      }
    } else if (req.method !== 'GET') {
      const isLedgerPreview =
        action === 'generate-ledgers' &&
        (req.body as { mode?: unknown } | undefined)?.mode === 'preview';
      const isLedgerApply = action === 'generate-ledgers' && !isLedgerPreview;
      // These three do not paginate. Widening the ledger button must not widen
      // them as a side effect.
      const isOtherHeavyMutation =
        action === 'rebuild-student-counts' ||
        action === 'reset-course' ||
        action === 'import-students';
      // A whole-center run pages through `classes` 20 at a time. 60 covers
      // 1200 classes with room for a retry; preview is read-only so it gets a
      // wider budget on its own scope.
      const maxAttempts = isLedgerPreview
        ? 120
        : isLedgerApply
          ? 60
          : isOtherHeavyMutation
            ? 10
            : 60;
      if (
        !(await enforceRateLimit(db, req, res, {
          scope: isLedgerPreview ? 'classes_ledger_preview' : 'classes_mutation',
          uid: user.uid,
          action,
          maxAttempts,
          windowMs: 60 * 1000,
          message: 'Too many class requests',
        }))
      ) {
        return;
      }
    }

    switch (action) {
      case 'create':
        return await handleCreate(req, res, db, user, userInfo);
      case 'update':
        return await handleUpdate(req, res, db, user, userInfo);
      case 'status':
        return await handleStatus(req, res, db, user, userInfo);
      case 'delete':
        return await handleDelete(req, res, db, user, userInfo);
      case 'import-students':
        return await handleImportStudents(req, res, db, user, userInfo);
      case 'update-salary':
        return await handleUpdateSalary(req, res, db, user, userInfo);
      case 'reset-course':
        return await handleResetCourse(req, res, db, user, userInfo);
      case 'generate-ledgers':
        return await handleGenerateLedgers(req, res, db, user, userInfo);
      case 'rebuild-student-counts':
        return await handleRebuildStudentCounts(req, res, db, user, userInfo);
      case 'save-settings':
        return await handleSaveSettings(req, res, db, user, userInfo);
      case 'save-holidays':
        return await handleSaveHolidays(req, res, db, user, userInfo);
      case 'create-substitute-request':
        return await handleCreateSubstituteRequest(req, res, db, user, userInfo);
      case 'accept-substitute-request':
        return await handleAcceptSubstituteRequest(req, res, db, user, userInfo);
      case 'cancel-substitute-request':
        return await handleCancelSubstituteRequest(req, res, db, user, userInfo);
      case 'save-availability':
        return await handleSaveAvailability(req, res, db, user, userInfo);
      case 'review-availability-change':
        return await handleReviewAvailabilityChange(req, res, db, user, userInfo);
      case 'save-availability-slot':
        return await handleSaveAvailabilitySlot(req, res, db, user, userInfo);
      case 'cancel-print-request':
        return await handleCancelPrintRequest(req, res, db, user, userInfo);
      case 'update-print-request-status':
        return await handleUpdatePrintRequestStatus(req, res, db, user, userInfo);
      case 'course-closing-status':
        return await handleCourseClosingStatus(req, res, db, user, userInfo);
      case 'approve-course-closing':
        return await handleApproveCourseClosing(req, res, db, user, userInfo);
      case 'exempt-course-closing-student':
        return await handleExemptCourseClosingStudent(req, res, db, user, userInfo);
      case 'course-closing-record-month':
        return await handleCourseClosingRecordMonth(req, res, db, user, userInfo);
      case 'course-closing-records':
        return await handleCourseClosingRecords(req, res, db, user, userInfo);
      case 'course-closing-record-file':
        return await handleCourseClosingRecordFile(req, res, db, user, userInfo);
      default:
        return res.status(404).json({ success: false, error: 'Unknown classes action' });
    }
  } catch (err) {
    console.error(`[Classes/${req.query.action}] Unhandled error:`, err);
    return sendApiError(res, err, 'Internal server error');
  }
}
