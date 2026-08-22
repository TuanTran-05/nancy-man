import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { withStatus } from '../../lib/http/helpers.js';

type UserInfo = { role: string; name: string };

export async function handleRecent(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: UserInfo
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    throw withStatus('Not authorized to read admissions', 403);
  }

  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50, 1),
    100
  );
  const cursor = req.query.cursor as string;

  let query = db
    .collection('admissions_history')
    .orderBy('timestamp', 'desc')
    .limit(limit + 1);
  if (cursor) {
    const startDoc = await db.collection('admissions_history').doc(cursor).get();
    if (startDoc.exists) {
      query = query.startAfter(startDoc);
    }
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;
  const docsToProcess = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const nextCursor =
    hasMore && docsToProcess.length > 0 ? docsToProcess[docsToProcess.length - 1].id : null;

  const studentIds = docsToProcess.map((doc) => String(doc.data().studentId || '')).filter(Boolean);
  const classIds = docsToProcess.map((doc) => String(doc.data().classId || '')).filter(Boolean);

  async function fetchDocsByIds(collectionName: string, ids: string[]): Promise<Map<string, any>> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return new Map();
    const refs = uniqueIds.map((id) => db.collection(collectionName).doc(id));
    const docMap = new Map<string, any>();
    const chunkSize = 100;
    for (let i = 0; i < refs.length; i += chunkSize) {
      const group = refs.slice(i, i + chunkSize);
      const snaps = await db.getAll(...group);
      snaps.forEach((s) => {
        if (s.exists) {
          docMap.set(s.id, s.data() || {});
        }
      });
    }
    return docMap;
  }

  const [studentMap, classMap] = await Promise.all([
    fetchDocsByIds('students', studentIds),
    fetchDocsByIds('classes', classIds),
  ]);

  const admissions = docsToProcess.map((doc) => {
    const history = doc.data() || {};
    const studentId = String(history.studentId || '');
    const classId = String(history.classId || '');
    const student = studentMap.get(studentId) || {};
    const classData = classMap.get(classId) || {};
    return {
      id: doc.id,
      ...history,
      studentName: String(student.name || studentId),
      className: String(classData.name || classId),
      studentLifecycle: student.studentLifecycle,
      trialReviewStatus: student.trialReviewStatus,
      trialSessionCount: student.trialSessionCount ?? history.trialSessionCount,
      trialRequiredSessions: student.trialRequiredSessions ?? history.trialRequiredSessions,
    };
  });

  return res.status(200).json({
    success: true,
    data: {
      admissions,
      page: {
        limit,
        nextCursor,
        hasMore,
      },
    },
  });
}
