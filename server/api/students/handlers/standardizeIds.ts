import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import { writeStudentAudit } from '../../lib/student/studentCreation.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  assertStudentIdentityMutationAllowed,
  } from '../../lib/maintenance/studentIdentityMaintenance.js';
import {
  claimStudentCodeInTransaction,
  demoteStudentCodePrimaryInTransaction,
  normalizeStudentCode,
  readStudentCodeClaimInTransaction,
  STUDENT_CODE_REGISTRY_COLLECTION,
  type StudentCodeRegistryRecord,
} from '../../lib/student/studentCodeRegistry.js';

/**
 * Renaming a page of student codes is a bulk identity change, so this endpoint
 * plans by default and writes only against a plan an operator has seen.
 *
 * The digest covers the documents to rename and their current codes, not the
 * codes they will receive: those are derived from the counter inside the
 * transaction and would differ between the plan call and the apply call for
 * reasons that have nothing to do with what the operator reviewed. What the
 * confirmation actually proves is "these are the profiles I looked at" — the
 * one thing a stale page of results would get wrong.
 */
function planDigestOf(plan: Array<{ id: string; from: string }>): string {
  return createHash('sha256')
    .update(JSON.stringify(plan.map((entry) => [entry.id, entry.from])))
    .digest('hex');
}

const DEFAULT_STANDARDIZE_STUDENT_IDS_BATCH_SIZE = 100;
const MAX_STANDARDIZE_STUDENT_IDS_BATCH_SIZE = 200;
const STUDENT_ID_RANGE_END = '\uf8ff';

function getBoundedBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STANDARDIZE_STUDENT_IDS_BATCH_SIZE;
  const integer = Math.trunc(parsed);
  if (integer < 1) return DEFAULT_STANDARDIZE_STUDENT_IDS_BATCH_SIZE;
  return Math.min(integer, MAX_STANDARDIZE_STUDENT_IDS_BATCH_SIZE);
}

function isStandardStudentId(value: unknown, prefix: string): boolean {
  const studentId = String(value || '');
  return studentId.startsWith(prefix) && /^HS\d{6}$/.test(studentId);
}

function extractStudentIdSequence(value: unknown, prefix: string): number {
  const studentId = String(value || '');
  if (!studentId.startsWith(prefix)) return 0;
  const sequence = Number.parseInt(studentId.slice(prefix.length), 10);
  return Number.isFinite(sequence) ? sequence : 0;
}

export async function handleStandardizeStudentIds(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string },
  userInfo: { role: string; name: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (userInfo.role !== 'admin')
    return res.status(403).json({ success: false, error: 'Only admins can standardize IDs' });

  try {
    const body = normalizeBody(req.body);
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const prefix = `HS${year}`;
    const batchSize = getBoundedBatchSize(body.batchSize ?? req.query.batchSize);
    const cursor =
      getString(body, 'cursor') || (typeof req.query.cursor === 'string' ? req.query.cursor : '');

    let studentsQuery = db.collection('students').orderBy(FieldPath.documentId());
    if (cursor) studentsQuery = studentsQuery.startAfter(cursor);
    const studentsSnap = await studentsQuery.limit(batchSize + 1).get();
    const docsToProcess = studentsSnap.docs.slice(0, batchSize);
    const hasMore = studentsSnap.docs.length > batchSize;
    const nextCursor = docsToProcess.length ? docsToProcess[docsToProcess.length - 1].id : null;
    const docsToUpdate = docsToProcess.filter(
      (docSnap) => !isStandardStudentId(docSnap.data().studentId, prefix)
    );
    const plan = docsToUpdate.map((docSnap) => ({
      id: docSnap.id,
      from: String(docSnap.data().studentId || ''),
    }));
    const planDigest = planDigestOf(plan);

    const requestedApply = body.apply === true;
    const confirmedDigest = getString(body, 'confirmPlanDigest');
    if (requestedApply && confirmedDigest !== planDigest) {
      // Either the operator confirmed a different page, or the data moved
      // between the plan and the apply. Both mean the renames about to happen
      // are not the renames that were reviewed.
      return res.status(409).json({
        success: false,
        error:
          'STUDENT_ID_STANDARDIZE_PLAN_STALE: the confirmed plan does not match the current page. ' +
          'Re-run without `apply` and confirm the new digest.',
        planDigest,
      });
    }
    const applying = requestedApply && plan.length > 0;

    if (applying) {
      await assertStudentIdentityMutationAllowed(db, {
        actorId: user.uid,
        operation: 'students:standardize-student-ids',
      });
      const counterRef = db.collection('_counters').doc(`students_${year}`);
      await runStudentIdentityMutationTransaction(db, { actorId: user.uid, operation: 'students:standardize-student-ids' }, async (tx) => {
        // Reads first, all of them: counter, legacy maximum, and the registry
        // record for every code on both sides of every rename.
        const counterSnap = await tx.get(counterRef);
        const maxExistingSnap = await tx.get(
          db
            .collection('students')
            .where('studentId', '>=', prefix)
            .where('studentId', '<', prefix + STUDENT_ID_RANGE_END)
            .orderBy('studentId', 'desc')
            .limit(1)
        );
        const counterSeq = counterSnap.exists ? Number(counterSnap.data()?.seq || 0) : 0;
        const maxExistingSeq = maxExistingSnap.empty
          ? 0
          : extractStudentIdSequence(maxExistingSnap.docs[0].data().studentId, prefix);
        const startSeq = Math.max(counterSeq, maxExistingSeq) + 1;

        const renames = await Promise.all(
          docsToUpdate.map(async (docSnap, index) => {
            const data = docSnap.data();
            const currentId = String(data.studentId || '');
            const newId = `${prefix}${String(startSeq + index).padStart(4, '0')}`;
            const previousNormalized = currentId ? normalizeStudentCode(currentId) : '';
            const claim = await readStudentCodeClaimInTransaction(tx, db, {
              normalizedCode: newId,
              canonicalProfileId: docSnap.id,
            });
            let previousRegistry: StudentCodeRegistryRecord | null = null;
            if (previousNormalized) {
              const previousSnap = await tx.get(
                db.doc(`${STUDENT_CODE_REGISTRY_COLLECTION}/${previousNormalized}`)
              );
              previousRegistry = previousSnap.exists
                ? (previousSnap.data() as StudentCodeRegistryRecord)
                : null;
            }
            return { docSnap, data, currentId, newId, previousNormalized, claim, previousRegistry };
          })
        );

        // Writes. Every claim runs before any profile update so a single
        // conflicting code aborts the page instead of half-renaming it.
        for (const rename of renames) {
          claimStudentCodeInTransaction(
            tx,
            db,
            {
              normalizedCode: rename.newId,
              canonicalProfileId: rename.docSnap.id,
              actorId: user.uid,
              isPrimary: true,
              status: 'active',
            },
            rename.claim
          );
          if (rename.previousRegistry) {
            demoteStudentCodePrimaryInTransaction(
              tx,
              db,
              {
                normalizedCode: rename.previousNormalized,
                canonicalProfileId: rename.docSnap.id,
                actorId: user.uid,
                status: 'alias',
              },
              { registry: rename.previousRegistry }
            );
          }
        }

        const finalSeq = startSeq + docsToUpdate.length - 1;
        const counterData = { seq: finalSeq, updatedAt: FieldValue.serverTimestamp() };
        if (counterSnap.exists) {
          tx.update(counterRef, counterData);
        } else {
          tx.create(counterRef, counterData);
        }

        for (const rename of renames) {
          const updates: Record<string, unknown> = {
            studentId: rename.newId,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (rename.data.code && String(rename.data.code) === rename.currentId) {
            updates.code = rename.newId;
          }
          tx.update(rename.docSnap.ref, updates);
        }
      });
    }

    await writeStudentAudit(req, db, user, userInfo, 'update', 'batch', undefined, {
      action: 'standardize-student-ids',
      mode: applying ? 'applied' : 'plan',
      planDigest,
      updated: applying ? plan.length : 0,
      candidates: plan.length,
      processed: docsToProcess.length,
      cursor: nextCursor,
      hasMore,
    });
    if (applying) {
      await Promise.all([touchRealtimeEvent('students'), touchRealtimeEvent('admin-summary')]);
    }

    return res.status(200).json({
      success: true,
      mode: applying ? 'applied' : 'plan',
      planDigest,
      plan,
      processed: docsToProcess.length,
      updated: applying ? plan.length : 0,
      candidates: plan.length,
      skipped: docsToProcess.length - plan.length,
      cursor: nextCursor,
      hasMore,
      batchSize,
    });
  } catch (err: any) {
    console.error('[Students/standardize-ids] Error:', err);
    return res
      .status(500)
      .json({ success: false, error: err.message || 'Failed to standardize student IDs' });
  }
}
