import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { getUserAgent, sendApiError } from '../../lib/http/helpers.js';

const EVALUATION_INSIGHTS_EVALUATION_LIMIT = 500;

export async function handleEvaluationInsights(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string }
) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const studentId = req.query.studentId as string;
  if (!studentId) return res.status(400).json({ success: false, error: 'Missing studentId' });

  const userDoc = await db.collection('users').doc(user.uid).get();
  const userData = userDoc.data() || {};
  const role = userData.role || null;

  const studentDoc = await db.collection('students').doc(studentId).get();
  if (!studentDoc.exists)
    return res.status(404).json({ success: false, error: 'Student not found' });
  const studentData = studentDoc.data() || {};

  if (role === 'teacher' && studentData.teacherId !== user.uid) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  if (role !== 'admin' && role !== 'teacher' && role !== 'office') {
    if (!userDoc.exists || userData.studentId !== studentId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }

  const classId = studentData.classId;
  if (!classId)
    return res.status(404).json({ success: false, error: 'Class not found for student' });

  const evalsSnap = await db
    .collection('evaluations')
    .where('classId', '==', classId)
    .limit(EVALUATION_INSIGHTS_EVALUATION_LIMIT)
    .get();
  let myScore: number | null = null;
  let rankCount = 1;
  let classification = '';

  const evals = evalsSnap.docs.filter((doc) => doc.data()?.isDeleted !== true).map((d) => d.data());
  const latestEvalsMap = new Map<string, Record<string, unknown>>();
  for (const e of evals) {
    if (!e.studentId) continue;
    const currentLatest = latestEvalsMap.get(e.studentId);
    if (
      !currentLatest ||
      new Date(String(e.createdAt || 0)).getTime() >
        new Date(String(currentLatest.createdAt || 0)).getTime()
    ) {
      latestEvalsMap.set(e.studentId, e);
    }
  }

  const myEval = latestEvalsMap.get(studentId);
  if (myEval) {
    myScore = Number(myEval.finalScore ?? myEval.totalScore ?? 0);
    for (const e of latestEvalsMap.values()) {
      const score = Number(e.finalScore ?? e.totalScore ?? 0);
      if (score > myScore) rankCount++;
    }
    if (myScore >= 8) classification = 'Giỏi';
    else if (myScore >= 6.5) classification = 'Khá';
    else if (myScore >= 5) classification = 'Trung bình';
    else classification = 'Yếu';
  }

  writeAuditLog(db, {
    userId: user.uid,
    userRole: role || 'unknown',
    userName:
      typeof userData.displayName === 'string'
        ? userData.displayName
        : typeof userData.email === 'string'
          ? userData.email
          : undefined,
    action: 'create',
    collection: 'students',
    documentId: studentId,
    metadata: { action: 'evaluation-insights' },
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  }).catch((err) => console.error('[AuditLog] Failed to write:', err));

  return res.status(200).json({
    rank: myScore !== null ? rankCount : null,
    classification: classification || null,
    myScore,
  });
}
