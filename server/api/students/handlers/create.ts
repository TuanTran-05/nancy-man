import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, sendApiError } from '../../lib/http/helpers.js';
import { validateBody, createStudentSchema } from '../../lib/validation/validations.js';
import { createStudentRecord } from '../../lib/student/studentCreation.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';

export async function handleCreate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = normalizeBody(req.body);
    const validation = validateBody(createStudentSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    // Rejected at the boundary so a maintenance window returns 503 without the
    // caller paying for a transaction. The transaction re-reads the state
    // anyway; this is an early exit, never the authorization.
    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'students:create',
    });
    const created = await createStudentRecord({
      req,
      db,
      user,
      userInfo,
      body,
      mutationOperation: 'student_create',
    });
    await refreshAccountingStudentSummariesAfterCommit(db, [created.id], 'student-created', {
      actorId: user.uid,
      operation: 'students:create',
    });
    await Promise.all([touchRealtimeEvent('students'), touchRealtimeEvent('admin-summary')]);
    return res.status(201).json({ success: true, id: created.id, studentId: created.studentId });
  } catch (err) {
    console.error('[Students/create] Error:', err);
    return sendApiError(res, err, 'Failed to create student');
  }
}
