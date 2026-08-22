import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CanonicalStudentPlacementStatus } from '../../../../../shared/canonicalStudentReadModel.js';
import {
  listCanonicalStudentDirectory,
  readCanonicalStudentContext,
  readCanonicalStudentsByIds,
} from '../../../lib/student/canonicalStudentReadRepository.js';
import type { AdminCandidateItem } from './adminChatTypes.js';
import type { AdminChatSession } from './adminSessionRepository.js';

export function normalizeVietnameseSearchText(text: string | unknown): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseOrdinalFromText(text: string): number | null {
  const normalized = normalizeVietnameseSearchText(text);

  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:nhat|1)\b/.test(normalized)) return 1;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:hai|2)\b/.test(normalized)) return 2;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:ba|3)\b/.test(normalized)) return 3;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:tu|bon|4)\b/.test(normalized)) return 4;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:nam|5)\b/.test(normalized)) return 5;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:sau|6)\b/.test(normalized)) return 6;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:bay|7)\b/.test(normalized)) return 7;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:tam|8)\b/.test(normalized)) return 8;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:chin|9)\b/.test(normalized)) return 9;
  if (/\b(?:em|ban|hoc sinh|nguoi)?\s*thu\s*(?:muoi|10)\b/.test(normalized)) return 10;

  const match = normalized.match(/\bthu\s*(\d{1,2})\b/);
  if (match) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 10) return num;
  }

  return null;
}

export type ResolvedTeacher = {
  teacherId: string;
  teacherName: string;
};

export type ResolvedClass = {
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
};

export type ResolvedCanonicalStudent = {
  id: string;
  fullName: string;
  studentCode: string;
  currentClassId: string | null;
  currentClassName: string | null;
  currentTeacherId: string | null;
  teacherName: string | null;
  placementStatus: CanonicalStudentPlacementStatus;
};

export type AdminStudentResolutionResult =
  | { status: 'resolved'; student: ResolvedCanonicalStudent }
  | { status: 'ambiguous'; candidates: AdminCandidateItem[]; omittedCount?: number }
  | { status: 'not_found'; hint: string }
  | { status: 'empty_hint' };

export type AdminTeacherResolutionResult =
  | { status: 'resolved'; teacher: ResolvedTeacher }
  | { status: 'ambiguous'; candidates: Array<{ teacherId: string; teacherName: string }> }
  | { status: 'not_found'; hint: string }
  | { status: 'empty_hint' };

export type AdminClassResolutionResult =
  | { status: 'resolved'; classObj: ResolvedClass }
  | {
      status: 'ambiguous';
      candidates: Array<{ classId: string; className: string; teacherName: string }>;
    }
  | { status: 'not_found'; hint: string }
  | { status: 'empty_hint' };

/**
 * Resolves a teacher by hint from the users collection.
 */
export async function resolveTeacher(
  db: DocumentStore,
  teacherHint?: string | null
): Promise<AdminTeacherResolutionResult> {
  const hint = String(teacherHint || '').trim();
  if (!hint) return { status: 'empty_hint' };

  const normHint = normalizeVietnameseSearchText(hint);
  const snap = await db.collection('users').where('role', '==', 'teacher').limit(100).get();

  const matches: ResolvedTeacher[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = String(data.name || data.displayName || '').trim();
    const normName = normalizeVietnameseSearchText(name);

    if (normName.includes(normHint) || normHint.includes(normName)) {
      matches.push({
        teacherId: doc.id,
        teacherName: name || doc.id,
      });
    }
  }

  if (matches.length === 1) {
    return { status: 'resolved', teacher: matches[0] };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', candidates: matches };
  }
  return { status: 'not_found', hint };
}

/**
 * Resolves a class by name hint and optional teacherId constraint.
 */
export async function resolveClass(
  db: DocumentStore,
  classHint?: string | null,
  teacherId?: string | null
): Promise<AdminClassResolutionResult> {
  const hint = String(classHint || '').trim();
  if (!hint) return { status: 'empty_hint' };

  const normHint = normalizeVietnameseSearchText(hint);
  const snap = await db.collection('classes').limit(200).get();

  // Pre-fetch teachers for class teacher names
  const teacherSnap = await db.collection('users').where('role', '==', 'teacher').limit(100).get();
  const teacherNameMap = new Map<string, string>();
  for (const doc of teacherSnap.docs) {
    const data = doc.data();
    teacherNameMap.set(doc.id, String(data.name || data.displayName || '').trim());
  }

  const matches: ResolvedClass[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const className = String(data.name || '').trim();
    const classTeacherId = String(data.teacherId || '').trim();
    const normClassName = normalizeVietnameseSearchText(className);

    if (teacherId && classTeacherId !== teacherId) {
      continue;
    }

    if (normClassName.includes(normHint) || normHint.includes(normClassName)) {
      matches.push({
        classId: doc.id,
        className: className || doc.id,
        teacherId: classTeacherId,
        teacherName: teacherNameMap.get(classTeacherId) || '',
      });
    }
  }

  if (matches.length === 1) {
    return { status: 'resolved', classObj: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      candidates: matches.map((m) => ({
        classId: m.classId,
        className: m.className,
        teacherName: m.teacherName,
      })),
    };
  }
  return { status: 'not_found', hint };
}

/**
 * Resolves a canonical student by student hint, session pending candidates,
 * ordinal references, and optional teacher / class constraints.
 */
export async function resolveStudent(
  db: DocumentStore,
  options: {
    studentHint?: string | null;
    teacherHint?: string | null;
    classHint?: string | null;
    rawQuestionText?: string;
    session?: AdminChatSession | null;
  }
): Promise<AdminStudentResolutionResult> {
  const { studentHint, teacherHint, classHint, rawQuestionText, session } = options;

  // 1. Check ordinal follow-up in session (e.g. "em thứ 2 đóng chưa?")
  if (
    rawQuestionText &&
    session &&
    session.pendingCandidateIds &&
    session.pendingCandidateIds.length > 0
  ) {
    const ordinal = parseOrdinalFromText(rawQuestionText);
    if (ordinal !== null) {
      if (ordinal >= 1 && ordinal <= session.pendingCandidateIds.length) {
        const candidateId = session.pendingCandidateIds[ordinal - 1];
        const ctx = await readCanonicalStudentContext(db, candidateId);
        if (ctx) {
          const [classSnap, teacherSnap] = await Promise.all([
            ctx.currentClassId
              ? db.collection('classes').doc(ctx.currentClassId).get()
              : Promise.resolve(null),
            ctx.currentTeacherId
              ? db.collection('users').doc(ctx.currentTeacherId).get()
              : Promise.resolve(null),
          ]);
          return {
            status: 'resolved',
            student: {
              id: ctx.canonicalProfileId,
              fullName: String(ctx.profile.name || '').trim(),
              studentCode: String(ctx.profile.studentId || '').trim(),
              currentClassId: ctx.currentClassId,
              currentClassName:
                classSnap && classSnap.exists
                  ? String(classSnap.data()?.name || classSnap.id)
                  : null,
              currentTeacherId: ctx.currentTeacherId,
              teacherName:
                teacherSnap && teacherSnap.exists
                  ? String(
                      teacherSnap.data()?.name || teacherSnap.data()?.displayName || teacherSnap.id
                    )
                  : null,
              placementStatus: ctx.placementStatus,
            },
          };
        }
      }
      return { status: 'not_found', hint: `thứ ${ordinal}` };
    }
  }

  // 2. Check implicit follow-up with lastStudentId when no hint is specified
  const trimmedHint = String(studentHint || '').trim();
  if (!trimmedHint) {
    if (session?.lastStudentId) {
      const ctx = await readCanonicalStudentContext(db, session.lastStudentId);
      if (ctx) {
        return {
          status: 'resolved',
          student: {
            id: ctx.canonicalProfileId,
            fullName: String(ctx.profile.name || '').trim(),
            studentCode: String(ctx.profile.studentId || '').trim(),
            currentClassId: ctx.currentClassId,
            currentClassName: null,
            currentTeacherId: ctx.currentTeacherId,
            teacherName: null,
            placementStatus: ctx.placementStatus,
          },
        };
      }
    }
    return { status: 'empty_hint' };
  }

  // 3. Resolve teacher constraint if teacherHint is present
  let resolvedTeacherId: string | null = null;
  if (teacherHint && teacherHint.trim()) {
    const teacherRes = await resolveTeacher(db, teacherHint);
    if (teacherRes.status === 'resolved') {
      resolvedTeacherId = teacherRes.teacher.teacherId;
    }
  }

  // 4. Resolve class constraint if classHint is present
  let resolvedClassId: string | null = null;
  if (classHint && classHint.trim()) {
    const classRes = await resolveClass(db, classHint, resolvedTeacherId);
    if (classRes.status === 'resolved') {
      resolvedClassId = classRes.classObj.classId;
    }
  }

  // 5. Query candidate students using canonical student directory search
  const dirPage = await listCanonicalStudentDirectory(db, {
    search: trimmedHint,
    classId: resolvedClassId || undefined,
    limit: 15,
  });

  let candidates = dirPage.rows;

  // Filter by teacherId constraint if teacher was resolved
  if (resolvedTeacherId) {
    candidates = candidates.filter((row) => row.currentTeacherId === resolvedTeacherId);
  }

  if (candidates.length === 0) {
    return { status: 'not_found', hint: trimmedHint };
  }

  // Build class and teacher lookup maps for readable candidate items
  const classIds = Array.from(
    new Set(candidates.map((c) => c.currentClassId).filter(Boolean) as string[])
  );
  const teacherIds = Array.from(
    new Set(candidates.map((c) => c.currentTeacherId).filter(Boolean) as string[])
  );

  const classNameMap = new Map<string, string>();
  if (classIds.length > 0) {
    const classSnaps = await Promise.all(
      classIds.map((cid) => db.collection('classes').doc(cid).get())
    );
    for (const snap of classSnaps) {
      if (snap.exists) classNameMap.set(snap.id, String(snap.data()?.name || snap.id));
    }
  }

  const teacherNameMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const teacherSnaps = await Promise.all(
      teacherIds.map((tid) => db.collection('users').doc(tid).get())
    );
    for (const snap of teacherSnaps) {
      if (snap.exists) {
        teacherNameMap.set(
          snap.id,
          String(snap.data()?.name || snap.data()?.displayName || snap.id)
        );
      }
    }
  }

  if (candidates.length === 1) {
    const row = candidates[0];
    return {
      status: 'resolved',
      student: {
        id: row.canonicalProfileId,
        fullName: String(row.profile.name || '').trim(),
        studentCode: String(row.profile.studentId || '').trim(),
        currentClassId: row.currentClassId,
        currentClassName: row.currentClassId
          ? (classNameMap.get(row.currentClassId) ?? null)
          : null,
        currentTeacherId: row.currentTeacherId,
        teacherName: row.currentTeacherId
          ? (teacherNameMap.get(row.currentTeacherId) ?? null)
          : null,
        placementStatus: row.placementStatus,
      },
    };
  }

  // Multiple candidates -> Return ambiguous candidate list
  const candidateItems: AdminCandidateItem[] = candidates.slice(0, 10).map((row) => ({
    id: row.canonicalProfileId,
    fullName: String(row.profile.name || '').trim(),
    code: String(row.profile.studentId || '').trim(),
    className: row.currentClassId ? (classNameMap.get(row.currentClassId) ?? null) : null,
    teacherName: row.currentTeacherId ? (teacherNameMap.get(row.currentTeacherId) ?? null) : null,
    statusLabel: row.placementStatus,
  }));

  return {
    status: 'ambiguous',
    candidates: candidateItems,
    omittedCount: Math.max(0, candidates.length - 10),
  };
}
