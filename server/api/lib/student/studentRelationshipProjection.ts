import { FieldValue } from '@/server/db/documentStore.js';
import type { CanonicalStudentReadMode } from '../../../../shared/canonicalStudentReadModel.js';

const LEGACY_RELATIONSHIP_FIELDS = ['classId', 'teacherId', 'enrollmentStatus'] as const;

type LegacyRelationshipField = (typeof LEGACY_RELATIONSHIP_FIELDS)[number];

export type StudentRelationshipProjectionInput = Partial<
  Record<LegacyRelationshipField, unknown>
>;

function copySuppliedRelationshipFields(
  input: StudentRelationshipProjectionInput
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of LEGACY_RELATIONSHIP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      fields[field] = input[field];
    }
  }
  return fields;
}

export function buildStudentRelationshipCreateFields(
  mode: CanonicalStudentReadMode,
  input: StudentRelationshipProjectionInput
): Record<string, unknown> {
  if (mode === 'canonical_required') return {};
  return copySuppliedRelationshipFields(input);
}

export function buildStudentRelationshipUpdateFields(
  mode: CanonicalStudentReadMode,
  input: StudentRelationshipProjectionInput
): Record<string, unknown> {
  if (mode !== 'canonical_required') return copySuppliedRelationshipFields(input);
  return {
    classId: FieldValue.delete(),
    teacherId: FieldValue.delete(),
    enrollmentStatus: FieldValue.delete(),
  };
}
