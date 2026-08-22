import {
  buildAdmissionSearchFields,
  normalizeAdmissionContact,
  normalizeAdmissionName,
} from '../../server/api/lib/admissions/matching.js';

/**
 * Plans the additive `admissionSearch*` backfill.
 *
 * The creation guard queries `students` by these three denormalized fields, and
 * a DocumentStore equality query omits documents that lack the field. Profiles
 * created by bulk import or by the class-promotion clone never received them,
 * so the guard is blind to exactly the duplicates it exists to catch until this
 * runs.
 *
 * Pure and DocumentStore-free so the classification can be tested directly.
 *
 * Two distinctions carry weight:
 *
 * - `drifted` is separated from `missing_fields`. A stale denormalized value is
 *   also a guard blind spot, but repairing it overwrites existing data, so it
 *   is opt-in rather than part of the additive default.
 * - `incomplete_source` is separated from everything else. These three fields
 *   are derived from `name`, `dob`, and `contact`; a profile missing one of
 *   those cannot be backfilled at all. Counting it as a coverage gap would make
 *   the "zero missing" gate permanently unreachable, so it is reported as a
 *   named residual exclusion for the baseline instead.
 */

export const ADMISSION_SEARCH_SOURCE_FIELDS = ['name', 'dob', 'contact'] as const;

export type AdmissionSearchBackfillState =
  | 'already_complete'
  | 'missing_fields'
  | 'drifted'
  | 'incomplete_source'
  | 'skipped_retired';

export type AdmissionSearchBackfillRow = {
  profileId: string;
  state: AdmissionSearchBackfillState;
  missingFields: string[];
  driftedFields: string[];
  incompleteSourceFields: string[];
  patch: Record<string, string>;
};

export type AdmissionSearchBackfillPlan = {
  scanned: number;
  rows: AdmissionSearchBackfillRow[];
  counts: Record<AdmissionSearchBackfillState, number>;
  backfillableProfileIds: string[];
  residualCoverageGapProfileIds: string[];
};

export type AdmissionSearchBackfillSource = { id: string; data: Record<string, unknown> };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRetired(data: Record<string, unknown>): boolean {
  return (
    data.studentProfileState === 'merged_tombstone' || text(data.mergedIntoStudentId).length > 0
  );
}

function emptyRow(profileId: string, state: AdmissionSearchBackfillState): AdmissionSearchBackfillRow {
  return {
    profileId,
    state,
    missingFields: [],
    driftedFields: [],
    incompleteSourceFields: [],
    patch: {},
  };
}

function planRow(source: AdmissionSearchBackfillSource): AdmissionSearchBackfillRow {
  const { id, data } = source;

  if (isRetired(data)) return emptyRow(id, 'skipped_retired');

  const incompleteSourceFields = ADMISSION_SEARCH_SOURCE_FIELDS.filter(
    (field) => text(data[field]) === ''
  );
  if (incompleteSourceFields.length > 0) {
    return { ...emptyRow(id, 'incomplete_source'), incompleteSourceFields: [...incompleteSourceFields] };
  }

  const derived = buildAdmissionSearchFields({
    name: text(data.name),
    dob: text(data.dob),
    contact: text(data.contact),
  });

  const missingFields: string[] = [];
  const driftedFields: string[] = [];
  const patch: Record<string, string> = {};

  for (const [field, expected] of Object.entries(derived)) {
    const stored = text(data[field]);
    if (stored === '') {
      missingFields.push(field);
      patch[field] = expected;
    } else if (stored !== expected) {
      driftedFields.push(field);
      patch[field] = expected;
    }
  }

  missingFields.sort((left, right) => left.localeCompare(right));
  driftedFields.sort((left, right) => left.localeCompare(right));

  if (missingFields.length > 0) {
    return { ...emptyRow(id, 'missing_fields'), missingFields, driftedFields, patch };
  }
  if (driftedFields.length > 0) {
    return { ...emptyRow(id, 'drifted'), driftedFields, patch };
  }
  return emptyRow(id, 'already_complete');
}

export function planAdmissionSearchBackfill(
  students: readonly AdmissionSearchBackfillSource[]
): AdmissionSearchBackfillPlan {
  const rows = [...students]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(planRow);

  const counts: Record<AdmissionSearchBackfillState, number> = {
    already_complete: 0,
    missing_fields: 0,
    drifted: 0,
    incomplete_source: 0,
    skipped_retired: 0,
  };
  for (const row of rows) counts[row.state] += 1;

  return {
    scanned: rows.length,
    rows,
    counts,
    backfillableProfileIds: rows
      .filter((row) => row.state === 'missing_fields' || row.state === 'drifted')
      .map((row) => row.profileId),
    residualCoverageGapProfileIds: rows
      .filter((row) => row.state === 'incomplete_source')
      .map((row) => row.profileId),
  };
}

export { normalizeAdmissionContact, normalizeAdmissionName };
