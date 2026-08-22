import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { getDb, verifyAuthContext } from '../lib/auth/verifyAuth.js';
import type { AuthRole } from '../lib/auth/roles.js';
import { sendApiError } from '../lib/http/helpers.js';
import { enforceRateLimit } from '../lib/auth/rateLimit.js';
import {
  authUserFromContext,
  mutationUserInfoFromContext,
} from '../lib/auth/contextUser.js';
import {
  handleAssignmentCreate,
  handleAssignmentUpdate,
  handleAssignmentDelete,
  handleAssignmentSubmit,
  handleAssignmentGrade,
  handleAssignmentDeleteSubmissions,
  handleGetQuizAnswers,
  handleGetAssessmentQuestionKeys,
  handleAssignmentProgressSummary,
} from './handlers/assignments.js';
import {
  handleAssignmentAttemptDraftClear,
  handleAssignmentAttemptDraftGet,
  handleAssignmentAttemptDraftSave,
} from './handlers/assignmentAttemptDrafts.js';
import {
  handleEvaluationCreate,
  handleEvaluationUpdate,
  handleEvaluationDelete,
  handleEvaluationSaveDailyReport,
  handleEvaluationConfirmSession,
  handleEvaluationGenerateAi,
} from './handlers/evaluations.js';
import { handleAssignmentMediaUpload } from './handlers/assignmentMedia.js';
import { handleAssignmentAnswerMediaUpload } from './handlers/assignmentAnswerMedia.js';
import {
  handleAssignmentDraftDelete,
  handleAssignmentDraftGet,
  handleAssignmentDraftList,
  handleAssignmentDraftPublish,
  handleAssignmentDraftSave,
  handleAssignmentDraftImportPreview,
  handleAssignmentDraftImportTemplate,
  handleMediaBankCreate,
  handleMediaBankSearch,
  handleQuestionBankCreate,
  handleQuestionBankReview,
  handleQuestionBankSearch,
  handleQuestionBankSubmitReview,
} from './handlers/assignmentAuthoring.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

async function requireEduContext(req: ApiRequest, res: ApiResponse, roles?: AuthRole[]) {
  const verified = await verifyAuthContext(req, res, roles);
  if (!verified) return null;
  const db = getDb();
  return {
    db,
    user: authUserFromContext(verified.context),
    userInfo: mutationUserInfoFromContext(verified.context),
    context: verified.context,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;

    if (
      await guardStudentIdentityRouteMutation(getDb, res, {
        surface: 'education',
        action,
        req,
      })
    )
      return;

    if (action?.startsWith('assessment-question-bank-')) {
      const auth = await requireEduContext(req, res, ['teacher', 'admin']);
      if (!auth) return;
      const bankAction = action.slice('assessment-question-bank-'.length);
      switch (bankAction) {
        case 'create':
          return await handleQuestionBankCreate(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'search':
          return await handleQuestionBankSearch(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'submit-review':
          return await handleQuestionBankSubmitReview(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'review':
          return await handleQuestionBankReview(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        default:
          return res.status(404).json({ success: false, error: 'Unknown question bank action' });
      }
    }

    if (action?.startsWith('assessment-media-bank-')) {
      const auth = await requireEduContext(req, res, ['teacher', 'admin']);
      if (!auth) return;
      const bankAction = action.slice('assessment-media-bank-'.length);
      switch (bankAction) {
        case 'create':
          return await handleMediaBankCreate(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        case 'search':
          return await handleMediaBankSearch(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        default:
          return res.status(404).json({ success: false, error: 'Unknown media bank action' });
      }
    }

    // ── Assignment routes ──────────────────────────────────────────────────
    if (action === 'get-quiz-answers') {
      const auth = await requireEduContext(req, res);
      if (!auth) return;
      return await handleGetQuizAnswers(req, res, auth.db, auth.user);
    }

    if (action === 'get-assessment-question-keys') {
      const auth = await requireEduContext(req, res);
      if (!auth) return;
      return await handleGetAssessmentQuestionKeys(req, res, auth.db, auth.user);
    }

    if (action === 'assignment-answer-media-upload') {
      const auth = await requireEduContext(req, res, ['student']);
      if (!auth) return;
      return await handleAssignmentAnswerMediaUpload(req, res, auth.db, auth.user);
    }

    if (action?.startsWith('assignment-draft-')) {
      const auth = await requireEduContext(req, res, ['teacher']);
      if (!auth) return;
      const draftAction = action.slice('assignment-draft-'.length);
      switch (draftAction) {
        case 'save':
          return await handleAssignmentDraftSave(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'list':
          return await handleAssignmentDraftList(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'get':
          return await handleAssignmentDraftGet(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'delete':
          return await handleAssignmentDraftDelete(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'publish':
          return await handleAssignmentDraftPublish(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'import-preview':
          return await handleAssignmentDraftImportPreview(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'import-template':
          return await handleAssignmentDraftImportTemplate(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        default:
          return res.status(404).json({ success: false, error: 'Unknown assignment draft action' });
      }
    }

    if (action === 'assignment-attempt-draft-get') {
      const auth = await requireEduContext(req, res, ['student']);
      if (!auth) return;
      return await handleAssignmentAttemptDraftGet(req, res, auth.db, auth.user);
    }

    if (action === 'assignment-attempt-draft-save') {
      const auth = await requireEduContext(req, res, ['student']);
      if (!auth) return;
      return await handleAssignmentAttemptDraftSave(req, res, auth.db, auth.user);
    }

    if (action === 'assignment-attempt-draft-clear') {
      const auth = await requireEduContext(req, res, ['student']);
      if (!auth) return;
      return await handleAssignmentAttemptDraftClear(req, res, auth.db, auth.user);
    }

    if (action === 'assignment-submit') {
      const auth = await requireEduContext(req, res, ['student']);
      if (!auth) return;
      return await handleAssignmentSubmit(req, res, auth.db, auth.user);
    }

    if (action?.startsWith('assignment-')) {
      const assignmentRoles: AuthRole[] = ['admin', 'teacher'];
      const auth = await requireEduContext(req, res, assignmentRoles);
      if (!auth) return;
      const assignmentAction = action.slice('assignment-'.length);
      if (
        req.method !== 'GET' &&
        !(await enforceRateLimit(auth.db, req, res, {
          scope: 'assignments_mutation',
          uid: auth.user.uid,
          action: assignmentAction,
          maxAttempts: 60,
          windowMs: 60 * 1000,
          message: 'Too many assignment requests',
        }))
      ) {
        return;
      }

      switch (assignmentAction) {
        case 'create':
          return await handleAssignmentCreate(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        case 'update':
          return await handleAssignmentUpdate(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        case 'delete':
          return await handleAssignmentDelete(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        case 'grade':
          return await handleAssignmentGrade(req, res, auth.db, auth.user.uid, auth.userInfo.role);
        case 'delete-submissions':
          return await handleAssignmentDeleteSubmissions(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'progress-summary':
          return await handleAssignmentProgressSummary(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        case 'media-upload':
          return await handleAssignmentMediaUpload(
            req,
            res,
            auth.db,
            auth.user.uid,
            auth.userInfo.role
          );
        default:
          return res.status(404).json({ success: false, error: 'Unknown assignment action' });
      }
    }

    // ── Evaluation routes ──────────────────────────────────────────────────
    if (action?.startsWith('evaluation-')) {
      const auth = await requireEduContext(req, res, ['admin', 'teacher']);
      if (!auth) return;
      const evaluationAction = action.slice('evaluation-'.length);
      const role = auth.userInfo.role;
      if (
        req.method !== 'GET' &&
        evaluationAction !== 'generate-ai' &&
        !(await enforceRateLimit(auth.db, req, res, {
          scope: 'evaluations_mutation',
          uid: auth.user.uid,
          action: evaluationAction,
          maxAttempts: 90,
          windowMs: 60 * 1000,
          message: 'Too many evaluation requests',
        }))
      ) {
        return;
      }

      switch (evaluationAction) {
        case 'create':
          return await handleEvaluationCreate(req, res, auth.db, auth.user.uid, role);
        case 'update':
          return await handleEvaluationUpdate(req, res, auth.db, auth.user.uid, role);
        case 'delete':
          return await handleEvaluationDelete(req, res, auth.db, auth.user.uid, role);
        case 'save-daily-report':
          return await handleEvaluationSaveDailyReport(req, res, auth.db, auth.user.uid, role);
        case 'confirm-session':
          return await handleEvaluationConfirmSession(req, res, auth.db, auth.user.uid, role);
        case 'generate-ai':
          return await handleEvaluationGenerateAi(req, res);
        default:
          return res.status(404).json({ success: false, error: 'Unknown evaluation action' });
      }
    }

    return res.status(404).json({ success: false, error: 'Unknown edu action' });
  } catch (err) {
    console.error(`[Edu/${req.query.action}] Error:`, err);
    return sendApiError(res, err, 'Edu request failed');
  }
}
