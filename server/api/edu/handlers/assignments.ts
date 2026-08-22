import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizeBody, getString, getOptionalString } from '../../lib/http/helpers.js';
import {
  assertStudentInClass,
  getUserContext,
  assertActiveUser,
  assertClassAccess,
} from '../../lib/auth/authz.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { validateBody, createAssignmentSchema } from '../../lib/validation/validations.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { commitWriteOperationsInChunks } from '../../lib/documentStore/batchWrites.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { isApiDateTime } from '../../../../shared/dateTimeFormat.js';
import { normalizeAssignmentProctoringMode } from '../../../../shared/assignmentProctoring.js';
import {
  normalizeAssignmentDeliveryPolicy,
  validateAssignmentDeliveryPolicy,
  canStudentAccessAssignment,
  canStudentReviewAssignmentResults,
  type AssignmentDeliveryPolicy,
} from '../../../../shared/assignmentDelivery.js';
import { buildAssignmentProgressSummary } from '../../../../shared/assignmentOperations.js';
import { buildAssignmentAttemptDraftId } from '../../../../shared/assignmentAttemptDraft.js';
import { runStudentIdentityMutationTransaction } from '../../lib/maintenance/studentIdentityMutationTransaction.js';
import { listCanonicalClassRosterProfiles } from '../../lib/student/canonicalClassRoster.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import {
  applyAssessmentQuestionGrades,
  extractAssessmentKeys,
  normalizeAssessmentAnswers,
  projectAssessmentKeysForReview,
  scoreAssessmentMultipleChoice,
  type AssessmentQuestionGradeInput,
  type PrivateAssessmentQuestionKey,
} from '../../../../shared/assignmentAssessment.js';

function extractAnswers(questions: Record<string, unknown>[]) {
  const safeQuestions: Record<string, unknown>[] = [];
  const answerMap: Record<string, string> = {};
  for (const q of questions) {
    const { correct_answer, ...rest } = q;
    safeQuestions.push(rest);
    if (q.id !== undefined && typeof correct_answer === 'string') {
      answerMap[String(q.id)] = correct_answer;
    }
  }
  return { safeQuestions, answerMap };
}

function isGpaVisibleSubmission(data: AppDocumentStore.DocumentData | undefined) {
  return data?.isDeleted !== true && data?.status === 'graded';
}

function assessmentKeyWriteOperations(
  assignmentRef: AppDocumentStore.DocumentReference,
  keyMap: ReturnType<typeof extractAssessmentKeys>['keyMap']
) {
  return Object.entries(keyMap).map(([questionId, key]) => ({
    type: 'set' as const,
    ref: assignmentRef.collection('assessment_question_keys').doc(questionId),
    data: key,
  }));
}

async function readAssessmentQuestionKeys(
  assignmentRef: AppDocumentStore.DocumentReference
): Promise<Record<string, PrivateAssessmentQuestionKey>> {
  const snap = await assignmentRef.collection('assessment_question_keys').get();
  const keyMap: Record<string, PrivateAssessmentQuestionKey> = {};
  for (const doc of snap.docs) {
    const data = doc.data() as PrivateAssessmentQuestionKey;
    keyMap[doc.id] = {
      questionId: String(data.questionId || doc.id),
      ...(data.correctAnswer !== undefined ? { correctAnswer: data.correctAnswer } : {}),
      ...(Array.isArray(data.acceptedAnswers) ? { acceptedAnswers: data.acceptedAnswers } : {}),
      ...(data.gradingMode !== undefined ? { gradingMode: data.gradingMode } : {}),
      ...(Array.isArray(data.rubric) ? { rubric: data.rubric } : {}),
    };
  }
  return keyMap;
}

/**
 * Whether every named recipient is actually in this class.
 *
 * Membership comes from the open enrollment, not from `students.classId`. That
 * field is a compatibility projection: it goes stale the moment an enrollment
 * changes without it, which made this check reject a student who had just
 * arrived and — the dangerous direction — accept one who had already left, so
 * their work went to a class they were no longer in.
 *
 * Ids are resolved first, because a saved draft can still name the retired
 * half of a merged pair.
 */
export async function assertDeliveryPolicyStudentsInClass(
  db: DocumentStore,
  classId: string,
  policy: AssignmentDeliveryPolicy
) {
  if (policy.targetMode !== 'selected_students') return;
  if (policy.assignedStudentIds.length === 0) return;

  const roster = await listCanonicalClassRosterProfiles(db, classId);
  const enrolled = new Set(roster.map((entry) => entry.id));

  for (const studentId of policy.assignedStudentIds) {
    let canonicalProfileId: string;
    try {
      ({ canonicalProfileId } = await resolveCanonicalStudentId(db, studentId));
    } catch {
      // An id that resolves to nothing is not a member of anything. Falling
      // back to the raw id would let a deleted profile look enrolled.
      throw Object.assign(new Error('Selected student is not in the assignment class'), {
        statusCode: 400,
      });
    }
    if (!enrolled.has(canonicalProfileId)) {
      throw Object.assign(new Error('Selected student is not in the assignment class'), {
        statusCode: 400,
      });
    }
  }
}

export async function handleAssignmentCreate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const validation = validateBody(createAssignmentSchema, body);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const title = getString(body, 'title');
  const dueDate = getString(body, 'dueDate');
  const classId = getString(body, 'classId');
  const proctoringMode = normalizeAssignmentProctoringMode(body.proctoringMode);

  await assertTeacherClassAccess(db, classId, uid, role);

  const questions = Array.isArray(body.questions) ? body.questions : [];
  const { safeQuestions, answerMap } = extractAnswers(questions);

  let assessmentExtraction;
  if (body.assessment !== undefined) {
    try {
      assessmentExtraction = extractAssessmentKeys(body.assessment);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Invalid assessment payload',
      });
    }
  } else {
    assessmentExtraction = { safeAssessment: undefined, keyMap: {} };
  }

  const rawDeliveryPolicy = body.deliveryPolicy;
  const deliveryPolicy = rawDeliveryPolicy
    ? validateAssignmentDeliveryPolicy(normalizeAssignmentDeliveryPolicy(rawDeliveryPolicy))
    : undefined;
  if (deliveryPolicy) {
    await assertDeliveryPolicyStudentsInClass(db, classId, deliveryPolicy);
  }

  const assignmentPayload: Record<string, unknown> = {
    title,
    description: getString(body, 'description'),
    dueDate,
    classId,
    type: getString(body, 'type') || 'homework',
    questions: safeQuestions,
    attemptsAllowed: Number(body.attemptsAllowed) || 1,
    proctoringMode,
    teacherId: uid,
    createdAt: new Date().toISOString(),
    isDeleted: false,
  };
  if (deliveryPolicy) {
    assignmentPayload.deliveryPolicy = deliveryPolicy;
  }
  if (assessmentExtraction.safeAssessment !== undefined) {
    assignmentPayload.assessment = assessmentExtraction.safeAssessment;
  }

  const ref = await db.collection('assignments').add(assignmentPayload);

  const privateWrites = [
    ...Object.entries(answerMap).map(([questionId, correctAnswer]) => ({
      type: 'set' as const,
      ref: ref.collection('quiz_answers').doc(questionId),
      data: { correct_answer: correctAnswer },
    })),
    ...assessmentKeyWriteOperations(ref, assessmentExtraction.keyMap),
  ];

  if (privateWrites.length > 0) {
    await commitWriteOperationsInChunks(db, privateWrites);
  }

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'create',
    collection: 'assignments',
    documentId: ref.id,
    metadata: { title, classId },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
    touchRealtimeEvent('assignments', { targetId: classId }),
  ]);
  return res.status(201).json({ success: true, id: ref.id });
}

export async function handleAssignmentUpdate(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'PUT')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const id = getString(body, 'id');
  if (!id) return res.status(400).json({ success: false, error: 'Missing assignment id' });

  const assignmentRef = db.collection('assignments').doc(id);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists)
    return res.status(404).json({ success: false, error: 'Assignment not found' });

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  if (role !== 'admin' && assignmentData.teacherId !== uid) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const nextClassId = getString(body, 'classId') || String(assignmentData.classId || '');
  const nextDueDate = getString(body, 'dueDate') || String(assignmentData.dueDate || '');
  if (body.dueDate !== undefined && nextDueDate && !isApiDateTime(nextDueDate)) {
    return res.status(400).json({ success: false, error: 'Invalid datetime format' });
  }
  await assertTeacherClassAccess(db, nextClassId, uid, role);

  let safeQuestions = assignmentData.questions;
  let answerMap: Record<string, string> = {};
  if (body.questions !== undefined) {
    const extracted = extractAnswers(Array.isArray(body.questions) ? body.questions : []);
    safeQuestions = extracted.safeQuestions;
    answerMap = extracted.answerMap;
  }

  let assessmentExtraction;
  if (body.assessment !== undefined) {
    try {
      assessmentExtraction = extractAssessmentKeys(body.assessment);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Invalid assessment payload',
      });
    }
  } else {
    assessmentExtraction = {
      safeAssessment: assignmentData.assessment,
      keyMap: {},
    };
  }

  const proctoringMode =
    body.proctoringMode !== undefined
      ? normalizeAssignmentProctoringMode(body.proctoringMode)
      : normalizeAssignmentProctoringMode(assignmentData.proctoringMode);

  const updatedPayload: Record<string, unknown> = {
    title: getString(body, 'title') || assignmentData.title,
    description: getOptionalString(body, 'description') ?? assignmentData.description,
    dueDate: nextDueDate,
    classId: nextClassId,
    type: getString(body, 'type') || assignmentData.type,
    questions: safeQuestions,
    attemptsAllowed:
      body.attemptsAllowed !== undefined
        ? Number(body.attemptsAllowed)
        : assignmentData.attemptsAllowed,
    proctoringMode,
    updatedAt: new Date().toISOString(),
  };
  if (assessmentExtraction.safeAssessment !== undefined) {
    updatedPayload.assessment = assessmentExtraction.safeAssessment;
  }
  if (body.deliveryPolicy !== undefined) {
    updatedPayload.deliveryPolicy = validateAssignmentDeliveryPolicy(
      normalizeAssignmentDeliveryPolicy(body.deliveryPolicy)
    );
    await assertDeliveryPolicyStudentsInClass(
      db,
      nextClassId,
      updatedPayload.deliveryPolicy as AssignmentDeliveryPolicy
    );
  }

  await assignmentRef.update(updatedPayload);

  if (body.questions !== undefined) {
    const existingAnswers = await assignmentRef.collection('quiz_answers').get();
    await commitWriteOperationsInChunks(db, [
      ...existingAnswers.docs.map((doc) => ({ type: 'delete' as const, ref: doc.ref })),
      ...Object.entries(answerMap).map(([questionId, correctAnswer]) => ({
        type: 'set' as const,
        ref: assignmentRef.collection('quiz_answers').doc(questionId),
        data: { correct_answer: correctAnswer },
      })),
    ]);
  }

  if (body.assessment !== undefined) {
    const existingAssessmentKeys = await assignmentRef.collection('assessment_question_keys').get();
    await commitWriteOperationsInChunks(db, [
      ...existingAssessmentKeys.docs.map((doc) => ({ type: 'delete' as const, ref: doc.ref })),
      ...assessmentKeyWriteOperations(assignmentRef, assessmentExtraction.keyMap),
    ]);
  }

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'update',
    collection: 'assignments',
    documentId: id,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
    touchRealtimeEvent('assignments', { targetId: nextClassId }),
  ]);
  return res.status(200).json({ success: true, id });
}

export async function handleAssignmentDelete(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'DELETE')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const id = getString(body, 'id') || (typeof req.query.id === 'string' ? req.query.id : '');
  if (!id) return res.status(400).json({ success: false, error: 'Missing assignment id' });

  const assignmentRef = db.collection('assignments').doc(id);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists)
    return res.status(404).json({ success: false, error: 'Assignment not found' });

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  if (role !== 'admin' && assignmentData.teacherId !== uid) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const submissionsSnap = await db.collection('submissions').where('assignmentId', '==', id).get();
  const removesGpaVisibleSubmission = submissionsSnap.docs.some((doc) =>
    isGpaVisibleSubmission(doc.data())
  );

  const classId = String(assignmentData.classId || '');
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
    touchRealtimeEvent('assignments', { targetId: classId }),
  ]);

  const deletedAt = new Date().toISOString();
  const deletionReason = getString(body, 'reason') || 'Deleted by staff';
  await commitWriteOperationsInChunks(db, [
    {
      type: 'update',
      ref: assignmentRef,
      data: { isDeleted: true, deletedAt, deletedBy: uid, deletionReason, updatedAt: deletedAt },
    },
    ...submissionsSnap.docs.map((doc) => ({
      type: 'update' as const,
      ref: doc.ref,
      data: {
        isDeleted: true,
        deletedAt,
        deletedBy: uid,
        deletionReason,
        deletedByAssignmentId: id,
        updatedAt: deletedAt,
      },
    })),
  ]);
  if (removesGpaVisibleSubmission) {
    await touchRealtimeEvent('submissions', { targetId: classId });
  }

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'delete',
    collection: 'assignments',
    documentId: id,
    metadata: { deletedSubmissions: submissionsSnap.size },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  return res.status(200).json({ success: true, id, deletedSubmissions: submissionsSnap.size });
}

export async function handleAssignmentSubmit(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const assignmentId = getString(body, 'assignmentId');
  if (!assignmentId) return res.status(400).json({ success: false, error: 'Missing assignmentId' });

  const { allowed } = await checkRateLimit(
    db,
    `assignment_submit:${user.uid}:${assignmentId}`,
    10,
    10 * 60 * 1000,
    { failClosed: true }
  );
  if (!allowed) return res.status(429).json({ success: false, error: 'Too many submissions' });

  const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
  if (!assignmentSnap.exists)
    return res.status(404).json({ success: false, error: 'Assignment not found' });

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  const userSnap = await db.collection('users').doc(user.uid).get();
  const userData = userSnap.data() || {};
  if (!userData.studentId) {
    return res.status(403).json({ success: false, error: 'Not authorized to submit assignment' });
  }
  if (
    !canStudentAccessAssignment(
      { classId: assignmentData.classId, deliveryPolicy: assignmentData.deliveryPolicy },
      { classId: userData.classId, studentId: userData.studentId }
    )
  ) {
    return res
      .status(403)
      .json({ success: false, error: 'Assignment is not available for this student' });
  }
  const studentData = await assertStudentInClass(
    db,
    String(userData.studentId),
    String(assignmentData.classId || '')
  );

  const dueMs = Date.parse(String(assignmentData.dueDate || ''));
  if (Number.isFinite(dueMs) && Date.now() > dueMs + 24 * 60 * 60 * 1000 - 1) {
    return res.status(400).json({ success: false, error: 'Assignment is past due' });
  }

  let grade: number | null = null;
  let status: 'submitted' | 'graded' = 'submitted';
  if (
    assignmentData.type === 'quiz' &&
    Array.isArray(body.quizAnswers) &&
    body.quizAnswers.length > 0
  ) {
    const answersSnap = await db
      .collection('assignments')
      .doc(assignmentId)
      .collection('quiz_answers')
      .get();
    const correctMap = new Map<string, string>();
    for (const doc of answersSnap.docs) {
      correctMap.set(doc.id, doc.data().correct_answer);
    }
    if (correctMap.size > 0) {
      let correctCount = 0;
      for (const ans of body.quizAnswers) {
        if (correctMap.get(String(ans.questionId)) === ans.selectedOption) {
          correctCount++;
        }
      }
      grade = Number(((correctCount / correctMap.size) * 10).toFixed(1));
      status = 'graded';
    }
  }

  const hasAssessmentV2 = assignmentData.assessment?.version === 2;
  const assessmentAnswers = hasAssessmentV2
    ? normalizeAssessmentAnswers(body.assessmentAnswers, assignmentData.assessment)
    : [];
  let assessmentScore = null;

  if (hasAssessmentV2) {
    const assessmentKeyMap = await readAssessmentQuestionKeys(
      db.collection('assignments').doc(assignmentId)
    );
    const scoring = scoreAssessmentMultipleChoice(
      assignmentData.assessment,
      assessmentAnswers,
      assessmentKeyMap
    );
    assessmentScore = scoring.score;
    grade = scoring.grade;
    status = scoring.canAutoGradeAll ? 'graded' : 'submitted';
  }

  const result = await runStudentIdentityMutationTransaction(
    db,
    { actorId: user.uid, operation: 'education:assignment-submit' },
    async (tx) => {
      const existingSnap = await tx.get(
        db
          .collection('submissions')
          .where('assignmentId', '==', assignmentId)
          .where('studentId', '==', String(userData.studentId))
          .orderBy('attemptNumber', 'desc')
          .limit(1)
      );
      const latestAttempt = existingSnap.empty
        ? 0
        : Number(existingSnap.docs[0].data().attemptNumber || 0);
      const nextAttempt = latestAttempt + 1;
      const attemptsAllowed = Math.max(Number(assignmentData.attemptsAllowed || 1), 1);
      if (nextAttempt > attemptsAllowed) {
        throw Object.assign(new Error('Attempt limit exceeded'), { statusCode: 409 });
      }

      const ref = db.collection('submissions').doc();
      tx.create(ref, {
        assignmentId,
        studentId: userData.studentId,
        studentName: String(studentData.name || ''),
        teacherId: assignmentData.teacherId,
        classId: assignmentData.classId,
        content: getString(body, 'content'),
        quizAnswers: hasAssessmentV2 ? [] : Array.isArray(body.quizAnswers) ? body.quizAnswers : [],
        assessmentAnswers,
        assessmentScore,
        grade,
        isDeleted: false,
        status,
        submittedAt: new Date().toISOString(),
        attemptNumber: nextAttempt,
        examIntegrity:
          body.examIntegrity && typeof body.examIntegrity === 'object' ? body.examIntegrity : null,
      });
      tx.delete(
        db
          .collection('assignment_attempt_drafts')
          .doc(buildAssignmentAttemptDraftId(assignmentId, String(userData.studentId)))
      );
      return { id: ref.id, attemptNumber: nextAttempt };
    }
  );

  writeAuditLog(db, {
    userId: user.uid,
    userRole: userData.role || 'student',
    action: 'create',
    collection: 'submissions',
    documentId: result.id,
    metadata: {
      assignmentId,
      classId: assignmentData.classId,
      attemptNumber: result.attemptNumber,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  const submitClassId = String(assignmentData.classId || '');
  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
    ...(status === 'graded' ? [touchRealtimeEvent('submissions', { targetId: submitClassId })] : []),
  ]);
  return res
    .status(201)
    .json({ success: true, id: result.id, attemptNumber: result.attemptNumber });
}

export async function handleAssignmentGrade(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const submissionId = getString(body, 'submissionId');
  if (!submissionId) return res.status(400).json({ success: false, error: 'Missing submissionId' });

  const submissionRef = db.collection('submissions').doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists)
    return res.status(404).json({ success: false, error: 'Submission not found' });

  const submissionData = submissionSnap.data()!;
  if (submissionData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Submission not found' });
  if (role !== 'admin' && submissionData.teacherId !== uid) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const assignmentRef = db.collection('assignments').doc(String(submissionData.assignmentId || ''));
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }
  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });

  const submissionClassId = String(submissionData.classId || assignmentData.classId || '');

  if (assignmentData.assessment?.version === 2 && Array.isArray(body.assessmentQuestionScores)) {
    let gradingResult;
    try {
      gradingResult = applyAssessmentQuestionGrades(
        assignmentData.assessment,
        submissionData.assessmentScore,
        body.assessmentQuestionScores as AssessmentQuestionGradeInput[]
      );
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Invalid assessment grading payload',
      });
    }

    const feedback = getString(body, 'feedback');
    await submissionRef.update({
      assessmentScore: gradingResult.assessmentScore,
      grade: gradingResult.grade,
      feedback,
      status: 'graded',
    });

    writeAuditLog(db, {
      userId: uid,
      userRole: role,
      action: 'update',
      collection: 'submissions',
      documentId: submissionId,
      metadata: { action: 'assessment-grade', grade: gradingResult.grade },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    }).catch((err) => console.error('[AuditLog] Failed to write:', err));

    await Promise.all([
      touchRealtimeEvent('parent-dashboard'),
      touchRealtimeEvent('submissions', { targetId: submissionClassId }),
    ]);

    return res.status(200).json({ success: true, id: submissionId });
  }

  const grade = Number(body.grade);
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
    return res.status(400).json({ success: false, error: 'Invalid grade' });
  }

  await submissionRef.update({
    grade,
    feedback: getString(body, 'feedback'),
    status: 'graded',
  });

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'update',
    collection: 'submissions',
    documentId: submissionId,
    metadata: { action: 'grade', grade: Number(body.grade) },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  await Promise.all([
    touchRealtimeEvent('parent-dashboard'),
    touchRealtimeEvent('submissions', { targetId: submissionClassId }),
  ]);
  return res.status(200).json({ success: true, id: submissionId });
}

export async function handleAssignmentDeleteSubmissions(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'DELETE')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const body = normalizeBody(req.body);
  const assignmentId = getString(body, 'assignmentId');
  if (!assignmentId) return res.status(400).json({ success: false, error: 'Missing assignmentId' });

  const assignmentRef = db.collection('assignments').doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists)
    return res.status(404).json({ success: false, error: 'Assignment not found' });

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  if (role !== 'admin' && assignmentData.teacherId !== uid) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const submissionsSnap = await db
    .collection('submissions')
    .where('assignmentId', '==', assignmentId)
    .get();
  const removesGpaVisibleSubmission = submissionsSnap.docs.some((doc) =>
    isGpaVisibleSubmission(doc.data())
  );

  const deletedAt = new Date().toISOString();
  await commitWriteOperationsInChunks(
    db,
    submissionsSnap.docs.map((doc) => ({
      type: 'update',
      ref: doc.ref,
      data: {
        isDeleted: true,
        deletedAt,
        deletedBy: uid,
        deletionReason: 'Deleted by staff',
        updatedAt: deletedAt,
      },
    }))
  );
  if (removesGpaVisibleSubmission) {
    await touchRealtimeEvent('submissions', { targetId: String(assignmentData.classId || '') });
  }

  writeAuditLog(db, {
    userId: uid,
    userRole: role,
    action: 'delete',
    collection: 'submissions',
    documentId: assignmentId,
    metadata: { action: 'delete-submissions', deletedCount: submissionsSnap.size },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  return res.status(200).json({ success: true, deleted: submissionsSnap.size });
}

export async function handleGetQuizAnswers(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string }
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId : '';
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'Missing assignmentId' });
  }

  const ctx = await getUserContext(db, user);
  assertActiveUser(ctx);

  const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
  if (!assignmentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  const classId = String(assignmentData.classId || '');

  await assertClassAccess(db, ctx, classId, 'read');

  if (ctx.role === 'student' || ctx.role === 'parent') {
    if (assignmentData.type !== 'quiz') {
      return res.status(400).json({ success: false, error: 'Assignment is not a quiz' });
    }

    const studentId = ctx.studentId || '';
    if (!studentId) {
      return res.status(403).json({ success: false, error: 'Student context missing' });
    }
    if (
      !canStudentAccessAssignment(
        { classId, deliveryPolicy: assignmentData.deliveryPolicy },
        { classId: ctx.classId, studentId }
      )
    ) {
      return res
        .status(403)
        .json({ success: false, error: 'Assignment is not available for this student' });
    }

    const submissionsSnap = await db
      .collection('submissions')
      .where('assignmentId', '==', assignmentId)
      .where('studentId', '==', studentId)
      .get();

    if (
      !canStudentReviewAssignmentResults({
        deliveryPolicy: assignmentData.deliveryPolicy,
        dueDate: String(assignmentData.dueDate || ''),
        submissionCount: submissionsSnap.size,
        attemptsAllowed: Number(assignmentData.attemptsAllowed || 1),
      })
    ) {
      return res.status(403).json({ success: false, error: 'Quiz answers are not available yet' });
    }
  }

  const answersSnap = await db
    .collection('assignments')
    .doc(assignmentId)
    .collection('quiz_answers')
    .get();

  const map: Record<string, string> = {};
  answersSnap.docs.forEach((doc) => {
    map[doc.id] = doc.data().correct_answer;
  });

  return res.status(200).json({ success: true, data: map });
}

export async function handleGetAssessmentQuestionKeys(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string }
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId : '';
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'Missing assignmentId' });
  }

  const ctx = await getUserContext(db, user);
  assertActiveUser(ctx);

  const assignmentRef = db.collection('assignments').doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  await assertClassAccess(db, ctx, String(assignmentData.classId || ''), 'read');

  if (assignmentData.assessment?.version !== 2) {
    return res.status(400).json({ success: false, error: 'Assignment is not Assessment v2' });
  }

  if (ctx.role === 'student' || ctx.role === 'parent') {
    const studentId = ctx.studentId || '';
    if (!studentId) {
      return res.status(403).json({ success: false, error: 'Student context missing' });
    }
    if (
      !canStudentAccessAssignment(
        { classId: assignmentData.classId, deliveryPolicy: assignmentData.deliveryPolicy },
        { classId: ctx.classId, studentId }
      )
    ) {
      return res
        .status(403)
        .json({ success: false, error: 'Assignment is not available for this student' });
    }

    const submissionsSnap = await db
      .collection('submissions')
      .where('assignmentId', '==', assignmentId)
      .where('studentId', '==', studentId)
      .get();

    if (
      !canStudentReviewAssignmentResults({
        deliveryPolicy: assignmentData.deliveryPolicy,
        dueDate: String(assignmentData.dueDate || ''),
        submissionCount: submissionsSnap.size,
        attemptsAllowed: Number(assignmentData.attemptsAllowed || 1),
      })
    ) {
      return res
        .status(403)
        .json({ success: false, error: 'Assessment answers are not available yet' });
    }
  }

  const keyMap = await readAssessmentQuestionKeys(assignmentRef);
  const data = projectAssessmentKeysForReview(
    keyMap,
    ctx.role === 'admin' || ctx.role === 'teacher' ? ctx.role : 'student'
  );
  return res.status(200).json({ success: true, data });
}

export async function handleAssignmentProgressSummary(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId : '';
  if (!assignmentId) {
    return res.status(400).json({ success: false, error: 'Missing assignmentId' });
  }

  const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
  if (!assignmentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.isDeleted === true)
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  const classId = String(assignmentData.classId || '');

  // Authorize teacher/admin against assignment class
  if (role !== 'admin') {
    try {
      await assertTeacherClassAccess(db, classId, uid, role);
    } catch {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
  }

  // Who is in the class, from the enrollment rather than the profile field.
  // The projection goes stale when a student moves, so delivery followed a
  // student who had left and skipped one who had arrived.
  const students = await listCanonicalClassRosterProfiles(db, classId);

  // Filter by delivery policy
  const policy = normalizeAssignmentDeliveryPolicy(assignmentData.deliveryPolicy);
  let targetStudents = students;
  if (policy.targetMode === 'selected_students') {
    targetStudents = students.filter((s) => policy.assignedStudentIds.includes(s.id));
  }

  // Load submissions
  const submissionsSnap = await db
    .collection('submissions')
    .where('assignmentId', '==', assignmentId)
    .get();
  const submissions = submissionsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      studentId: String(data.studentId || ''),
      studentName: String(data.studentName || ''),
      status: String(data.status || ''),
      submittedAt: String(data.submittedAt || ''),
      grade: data.grade !== undefined ? data.grade : null,
      assessmentScore: data.assessmentScore !== undefined ? data.assessmentScore : null,
    };
  });

  const summary = buildAssignmentProgressSummary({
    now: new Date(),
    dueDate: String(assignmentData.dueDate || ''),
    targetStudents,
    submissions,
  });

  return res.status(200).json({ success: true, data: summary });
}
