import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody } from '../../lib/http/helpers.js';
import { validateBody, siblingLinkSchema } from '../../lib/validation/validations.js';
import { writeStudentAudit } from '../../lib/student/studentCreation.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { resolveCanonicalStudentIdInTransaction } from '../../lib/student/studentIdentityResolver.js';

function withStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export type SiblingGroupAssignmentInput = {
  studentGroupId: string;
  siblingGroupId: string;
  newGroupId: string;
  confirmMerge: boolean;
};

/**
 * Decides which group id two students end up sharing. Merging two established
 * groups joins two families, so it needs explicit confirmation rather than
 * happening silently on a mis-click.
 */
export function resolveSiblingGroupAssignment(
  input: SiblingGroupAssignmentInput
): { groupId: string; merged: boolean } {
  const { studentGroupId, siblingGroupId, newGroupId, confirmMerge } = input;

  if (!studentGroupId && !siblingGroupId) return { groupId: newGroupId, merged: false };
  if (studentGroupId && !siblingGroupId) return { groupId: studentGroupId, merged: false };
  if (!studentGroupId && siblingGroupId) return { groupId: siblingGroupId, merged: false };
  if (studentGroupId === siblingGroupId) return { groupId: studentGroupId, merged: false };

  if (!confirmMerge) throw withStatus('merge_confirmation_required', 409);
  return { groupId: studentGroupId, merged: true };
}

function newSiblingGroupId(): string {
  return `sib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function handleSiblings(
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
    const validation = validateBody(siblingLinkSchema, body);
    if (validation.success === false) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const { op, studentId: requestedStudentId, siblingId: requestedSiblingId, confirmMerge } =
      validation.data;

    if (op === 'link' && !requestedSiblingId) {
      return res.status(400).json({ success: false, error: 'siblingId is required' });
    }

    const students = db.collection('students');

    // Every document this transaction rewrites, so each one can be audited.
    const result = await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:siblings' }, async (tx) => {
      // Resolved inside the transaction, and before anything is read or
      // written. A sibling link stamped on a retired profile is invisible: the
      // family looks linked to whoever wrote it and unlinked to everyone
      // reading the surviving profile.
      const studentId = (await resolveCanonicalStudentIdInTransaction(tx, db, requestedStudentId))
        .canonicalProfileId;
      const siblingId = requestedSiblingId
        ? (await resolveCanonicalStudentIdInTransaction(tx, db, requestedSiblingId))
            .canonicalProfileId
        : '';

      // After resolution, not before. Two different ids that name the same
      // human pass a raw string compare and would link a child to themselves.
      if (op === 'link' && siblingId === studentId) {
        throw withStatus('A student cannot be their own sibling', 400);
      }

      const studentSnap = await tx.get(students.doc(studentId));
      if (!studentSnap.exists) throw withStatus('Student not found', 404);
      const studentGroupId = String(studentSnap.data()?.siblingGroupId || '').trim();

      if (op === 'unlink') {
        if (!studentGroupId) {
          return { groupId: '', merged: false, changed: [] as string[][], siblingId };
        }

        const groupSnap = await tx.get(students.where('siblingGroupId', '==', studentGroupId));
        const others = groupSnap.docs.filter((doc) => doc.id !== studentId);
        const changed: string[][] = [[studentId, studentGroupId, '']];

        tx.update(students.doc(studentId), {
          siblingGroupId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Invariant: a group never has exactly one member.
        if (others.length === 1) {
          tx.update(others[0].ref, {
            siblingGroupId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          changed.push([others[0].id, studentGroupId, '']);
        }
        return { groupId: '', merged: false, changed, siblingId };
      }

      const siblingSnap = await tx.get(students.doc(siblingId));
      if (!siblingSnap.exists) throw withStatus('Sibling not found', 404);
      const siblingGroupId = String(siblingSnap.data()?.siblingGroupId || '').trim();

      const { groupId, merged } = resolveSiblingGroupAssignment({
        studentGroupId,
        siblingGroupId,
        newGroupId: newSiblingGroupId(),
        confirmMerge: Boolean(confirmMerge),
      });

      const movedDocs = merged
        ? (await tx.get(students.where('siblingGroupId', '==', siblingGroupId))).docs
        : [];

      const changed: string[][] = [];
      const stamp = { siblingGroupId: groupId, updatedAt: FieldValue.serverTimestamp() };

      if (studentGroupId !== groupId) {
        tx.update(students.doc(studentId), stamp);
        changed.push([studentId, studentGroupId, groupId]);
      }
      if (siblingGroupId !== groupId) {
        tx.update(students.doc(siblingId), stamp);
        changed.push([siblingId, siblingGroupId, groupId]);
      }
      for (const doc of movedDocs) {
        if (doc.id === siblingId) continue;
        tx.update(doc.ref, stamp);
        changed.push([doc.id, siblingGroupId, groupId]);
      }

      return { groupId, merged, changed, siblingId };
    });

    // One audit entry per document actually rewritten, with real before/after.
    for (const [documentId, before, after] of result.changed) {
      await writeStudentAudit(
        req,
        db,
        user,
        userInfo,
        'update',
        documentId,
        { siblingGroupId: { before: before || null, after: after || null } },
        // The resolved counterpart, so the audit names the profile actually
        // written rather than whichever id the caller happened to hold.
        { op, merged: result.merged, counterpartId: result.siblingId || null }
      );
    }
    await touchRealtimeEvent('students');

    return res
      .status(200)
      .json({ success: true, groupId: result.groupId, merged: result.merged });
  } catch (err) {
    const statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
    const message = err instanceof Error ? err.message : 'Failed to update sibling link';
    console.error('[Students] Sibling link error:', err);
    return res.status(statusCode).json({
      success: false,
      errorCode: statusCode === 409 ? 'merge_confirmation_required' : 'sibling_link_failed',
      error: statusCode >= 500 ? 'Failed to update sibling link' : message,
    });
  }
}
