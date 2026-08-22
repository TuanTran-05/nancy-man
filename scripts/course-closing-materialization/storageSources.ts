import {
  courseClosingStoragePath,
  type ClosingDocumentType,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import type { MaterializationStorageState } from './types.js';

const DOCUMENT_TYPES: ClosingDocumentType[] = ['evaluation', 'tuition'];

export async function inspectCourseClosingStorage(
  records: CourseClosingRecord[],
  fileExists: (storagePath: string) => Promise<boolean>
): Promise<MaterializationStorageState[]> {
  const states: MaterializationStorageState[] = [];
  const orderedRecords = [...records].sort((left, right) => left.id.localeCompare(right.id));

  for (const record of orderedRecords) {
    for (const documentType of DOCUMENT_TYPES) {
      const expectedStoragePath = courseClosingStoragePath({
        closingMonth: record.closingMonth,
        classId: record.classId,
        courseId: record.courseId,
        studentId: record.studentId,
        documentType,
        templateVersion: 1,
      });
      states.push({
        recordId: record.id,
        documentType,
        expectedStoragePath,
        exists: await fileExists(expectedStoragePath),
      });
    }
  }

  return states;
}
