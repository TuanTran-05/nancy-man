import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { getDb, verifyAuthContext } from '../lib/auth/verifyAuth.js';
import { enforceRateLimit } from '../lib/auth/rateLimit.js';
import { sendApiError } from '../lib/http/helpers.js';
import type { AuthRole } from '../lib/auth/roles.js';
import {
  authUserFromContext,
  mutationUserInfoFromContext,
} from '../lib/auth/contextUser.js';
import { handleSearch } from './handlers/search.js';
import { handleCreateTrial } from './handlers/createTrial.js';
import {
  handleAddToWaitlist,
  handleDeletePending,
  handleListPending,
} from './handlers/waitlist.js';
import { handleTrialDecision } from './handlers/trialDecision.js';
import { handleRecent } from './handlers/recent.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const action = String(req.query.action || '');
  try {
    if (handleCorsPreflight(req, res)) return;
    const roles: AuthRole[] =
      action === 'trial-decision' ? ['admin', 'teacher'] : ['admin', 'office'];
    const verified = await verifyAuthContext(req, res, roles);
    if (!verified) return;
    const db = getDb();

    if (await guardStudentIdentityRouteMutation(() => db, res, { surface: 'admissions', action, req }))
      return;
    const user = authUserFromContext(verified.context);
    const userInfo = mutationUserInfoFromContext(verified.context);
    if (
      !(await enforceRateLimit(db, req, res, {
        scope: 'admissions_mutation',
        uid: user.uid,
        action,
        maxAttempts: 60,
        windowMs: 60 * 1000,
        message: 'Too many admissions requests',
      }))
    ) {
      return;
    }

    if (action === 'search-historical') return await handleSearch(req, res, db, userInfo);
    if (action === 'create-trial') return await handleCreateTrial(req, res, db, user, userInfo);
    if (action === 'add-to-waitlist')
      return await handleAddToWaitlist(req, res, db, user, userInfo);
    if (action === 'delete-pending') return await handleDeletePending(req, res, db, user, userInfo);
    if (action === 'list-pending') return await handleListPending(req, res, db, userInfo);
    if (action === 'trial-decision') {
      return await handleTrialDecision(req, res, db, user, userInfo);
    }
    if (action === 'recent') return await handleRecent(req, res, db, userInfo);
    return res.status(404).json({ success: false, error: 'Unknown admissions action' });
  } catch (err) {
    console.error(`[admissions/${action}] Error:`, err);
    return sendApiError(res, err, 'Admissions request failed');
  }
}
