import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { verifyAuthContext, getDb } from '../lib/auth/verifyAuth.js';
import { enforceRateLimit } from '../lib/auth/rateLimit.js';
import { sendApiError } from '../lib/http/helpers.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { handleCreate } from './handlers/create.js';
import { handleUpdate } from './handlers/update.js';
import { handleStatus } from './handlers/status.js';
import { handleDelete } from './handlers/delete.js';
import { handleEvaluationInsights } from './handlers/evaluationInsights.js';
import { handleUpdateProfile } from './handlers/updateProfile.js';
import { handleStandardizeStudentIds } from './handlers/standardizeIds.js';
import { handleImport } from './handlers/import.js';
import { handleTransfer } from './handlers/transfer.js';
import { handleSiblings } from './handlers/siblings.js';
import { handleCourseEnrollment } from './handlers/courseEnrollment.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

async function enforceStudentMutationLimit(
  req: ApiRequest,
  res: ApiResponse,
  db: any,
  uid: string,
  action: string
) {
  if (req.method === 'GET') return true;
  return enforceRateLimit(db, req, res, {
    scope: 'students_mutation',
    uid,
    action,
    maxAttempts: 60,
    windowMs: 60 * 1000,
    message: 'Too many student requests',
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;
    const db = getDb();

    // Early, clean refusal during the normalization window. The authorization
    // itself lives in each business transaction, which re-reads maintenance
    // before its first write; this only spares the operator a half-applied
    // request and a generic error.
    if (await guardStudentIdentityRouteMutation(() => db, res, { surface: 'students', action, req }))
      return;

    switch (action) {
      case 'create': {
        const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleCreate(req, res, db, user, userInfo);
      }
      case 'update': {
        const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleUpdate(req, res, db, user, userInfo);
      }
      case 'status': {
        const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleStatus(req, res, db, user, userInfo);
      }
      case 'siblings': {
        const verified = await verifyAuthContext(req, res, ['admin', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleSiblings(req, res, db, user, userInfo);
      }
      case 'delete': {
        const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleDelete(req, res, db, user, userInfo);
      }
      case 'evaluation-insights': {
        const verified = await verifyAuthContext(req, res);
        if (!verified) return;
        const user = verified.decoded;
        return await handleEvaluationInsights(req, res, db, user);
      }
      case 'update-profile': {
        const verified = await verifyAuthContext(req, res);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        return await handleUpdateProfile(req, res, db, user);
      }
      case 'standardize-student-ids': {
        const verified = await verifyAuthContext(req, res, ['admin']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleStandardizeStudentIds(req, res, db, user, userInfo);
      }
      case 'import': {
        const verified = await verifyAuthContext(req, res, ['admin', 'teacher', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (
          !(await enforceRateLimit(db, req, res, {
            scope: 'students_mutation',
            uid,
            action: 'import',
            maxAttempts: 20,
            windowMs: 60 * 1000,
            message: 'Too many student import requests',
          }))
        ) {
          return;
        }
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleImport(req, res, db, user, userInfo);
      }
      case 'transfer': {
        const verified = await verifyAuthContext(req, res, ['admin', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleTransfer(req, res, db, user, userInfo);
      }
      case 'course-enrollment': {
        const verified = await verifyAuthContext(req, res, ['admin', 'office']);
        if (!verified) return;
        const { uid } = verified.context;
        if (!(await enforceStudentMutationLimit(req, res, db, uid, action))) return;
        const user = verified.decoded;
        const userInfo = { role: verified.context.role, name: verified.context.name };
        return await handleCourseEnrollment(req, res, db, user, userInfo);
      }
      default:
        return res.status(404).json({ success: false, error: 'Unknown students action' });
    }
  } catch (err) {
    console.error(`[Students/${req.query.action}] Unhandled error:`, err);
    return sendApiError(res, err, 'Internal server error');
  }
}
