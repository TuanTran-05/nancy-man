import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { canManageAcademicRecords } from '../../lib/auth/permissions.js';
import { withStatus } from '../../lib/http/helpers.js';
import { admissionSearchSchema, validateBody } from '../../lib/validation/validations.js';
import { findAdmissionMatches, type AdmissionStudentMatch } from '../../lib/admissions/matching.js';

type UserInfo = { role: string; name: string };

function getLatestClassId(match: AdmissionStudentMatch) {
  const classId = String(match.data.classId || match.data.trialClassId || '').trim();
  return classId || undefined;
}

async function loadClassNames(db: DocumentStore, matches: AdmissionStudentMatch[]) {
  const classIds = [...new Set(matches.map(getLatestClassId).filter(Boolean) as string[])];
  const entries = await Promise.all(
    classIds.map(async (classId) => {
      const classSnap = await db.collection('classes').doc(classId).get();
      const classData = classSnap?.exists ? classSnap.data() || {} : {};
      return [classId, String(classData.name || classId)] as const;
    })
  );
  return new Map(entries);
}

function publicMatch(match: AdmissionStudentMatch, classNames: Map<string, string>) {
  const latestClassId = getLatestClassId(match);
  return {
    id: match.id,
    data: match.data,
    reasons: match.reasons,
    latestClassId,
    latestClassName: latestClassId ? classNames.get(latestClassId) || latestClassId : undefined,
  };
}

export async function handleSearch(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  userInfo: UserInfo
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!canManageAcademicRecords(userInfo.role)) {
    throw withStatus('Not authorized for admissions search', 403);
  }
  const input = {
    name: typeof req.query.name === 'string' ? req.query.name : '',
    dob: typeof req.query.dob === 'string' ? req.query.dob : '',
    contact: typeof req.query.contact === 'string' ? req.query.contact : '',
  };
  const validation = validateBody(admissionSearchSchema, input);
  if (validation.success === false) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  const matches = await findAdmissionMatches(db, validation.data);
  const publicMatches = [...matches.exactMatches, ...matches.possibleMatches];
  const classNames = await loadClassNames(db, publicMatches);
  return res.status(200).json({
    success: true,
    data: {
      exactMatches: matches.exactMatches.map((match) => publicMatch(match, classNames)),
      possibleMatches: matches.possibleMatches.map((match) => publicMatch(match, classNames)),
    },
  });
}
