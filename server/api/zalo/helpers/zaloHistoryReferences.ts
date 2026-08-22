import type { DocumentStore } from '@/server/db/documentStore.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';

export type ZaloHistoryReferences = {
  students: Map<string, { studentName: string; studentCode: string }>;
  studentsByPhone: Map<string, { studentName: string; studentCode: string }>;
  classes: Map<string, string>;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export async function loadZaloHistoryReferences(
  db: DocumentStore
): Promise<ZaloHistoryReferences> {
  const [studentsSnap, classesSnap] = await Promise.all([
    db.collection('students').get(),
    db.collection('classes').get(),
  ]);
  const students = new Map<string, { studentName: string; studentCode: string }>();
  const studentsByPhone = new Map<string, { studentName: string; studentCode: string }>();
  const ambiguousPhones = new Set<string>();

  for (const doc of studentsSnap.docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    const student = {
      studentName: asString(data.name || data.studentName),
      studentCode: asString(data.code || data.studentId),
    };
    students.set(doc.id, student);

    const phone = normalizePhoneVN(asString(data.contact || data.phone));
    if (!phone || ambiguousPhones.has(phone)) continue;
    if (studentsByPhone.has(phone)) {
      studentsByPhone.delete(phone);
      ambiguousPhones.add(phone);
    } else {
      studentsByPhone.set(phone, student);
    }
  }

  return {
    students,
    studentsByPhone,
    classes: new Map(
      classesSnap.docs.map((doc) => {
        const data = (doc.data() || {}) as Record<string, unknown>;
        return [doc.id, asString(data.name || data.className)];
      })
    ),
  };
}

export function enrichZaloHistoryData(
  data: Record<string, unknown>,
  references: ZaloHistoryReferences
): Record<string, unknown> {
  const student =
    references.students.get(asString(data.studentId)) ||
    references.studentsByPhone.get(normalizePhoneVN(asString(data.phone)));
  const className = references.classes.get(asString(data.classId));

  return {
    ...data,
    studentName: asString(data.studentName) || student?.studentName || '',
    studentCode: asString(data.studentCode) || student?.studentCode || '',
    className: asString(data.className) || className || '',
  };
}
