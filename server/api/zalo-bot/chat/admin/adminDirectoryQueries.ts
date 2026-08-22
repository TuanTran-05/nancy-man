import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  isDashboardReadModelStale,
  type DashboardReadModelV3,
} from '../../../../../shared/dashboardReadModel.js';
import type {
  AdminDataQuality,
  AdminDataQualityIssue,
  AdminDirectoryLookupResult,
  AdminHeadcountResult,
  AdminPhoneResult,
} from './adminChatTypes.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';

/**
 * Returns structured canonical directory details for a resolved student.
 */
export async function queryAdminStudentLookup(
  _db: DocumentStore,
  student: ResolvedCanonicalStudent,
  now = new Date()
): Promise<AdminDirectoryLookupResult> {
  const computedAt = now.toISOString();

  return {
    kind: 'directory_lookup',
    student: {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      currentClassName: student.currentClassName,
      teacherName: student.teacherName,
      placementStatus: student.placementStatus,
    },
    quality: {
      status: 'complete',
      issues: [],
    },
    computedAt,
    source: 'canonical_students_v1',
  };
}

/**
 * Returns phone contact information for a resolved canonical student.
 * Only accesses canonical student profile contact field.
 */
export async function queryAdminStudentPhone(
  db: DocumentStore,
  student: ResolvedCanonicalStudent,
  now = new Date()
): Promise<AdminPhoneResult> {
  const computedAt = now.toISOString();
  const snap = await db.collection('students').doc(student.id).get();

  let phone = '';
  if (snap.exists) {
    const data = snap.data();
    phone = String(data?.contact || data?.phone || '').trim();
  }

  const issues: AdminDataQualityIssue[] = [];
  let status: AdminDataQuality['status'] = 'complete';

  if (!phone) {
    status = 'degraded';
    issues.push({
      code: 'source_incomplete',
      source: 'canonical_profile_contact',
    });
  }

  return {
    kind: 'student_phone',
    student: {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      className: student.currentClassName,
      phone,
    },
    quality: {
      status,
      issues,
    },
    computedAt,
    source: 'canonical_students_contact_v1',
  };
}

/**
 * Queries center-wide headcount broken down across all 5 canonical placement states
 * from the standard DashboardReadModelV3 read model.
 */
export async function queryAdminCenterHeadcount(
  db: DocumentStore,
  now = new Date()
): Promise<AdminHeadcountResult> {
  const computedAt = now.toISOString();
  const snapshot = await db.collection('read_models').doc('dashboard_global').get();

  const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
  const model = (data?.canonicalHeadcount || data) as DashboardReadModelV3 | undefined;

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  if (!model || model.schemaVersion !== 3) {
    qualityStatus = 'failed';
    issues.push({
      code: 'source_incomplete',
      source: 'read_models/dashboard_global',
    });

    return {
      kind: 'center_headcount',
      totalCanonical: null,
      breakdown: {
        studying: null,
        trial: null,
        on_leave: null,
        waiting_for_placement: null,
        inactive: null,
      },
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'read_models/dashboard_global',
    };
  }

  if (model.complete !== true) {
    qualityStatus = 'degraded';
    issues.push({
      code: 'source_incomplete',
      source: 'read_models/dashboard_global',
    });
  }

  if (isDashboardReadModelStale(model, now)) {
    qualityStatus = 'degraded';
    issues.push({
      code: 'stale',
      source: 'read_models/dashboard_global',
    });
  }

  return {
    kind: 'center_headcount',
    totalCanonical: model.canonicalProfileCount ?? 0,
    breakdown: {
      studying: model.studyingCanonicalCount ?? 0,
      trial: model.trialCanonicalCount ?? 0,
      on_leave: model.onLeaveCanonicalCount ?? 0,
      waiting_for_placement: model.waitingForPlacementCanonicalCount ?? 0,
      inactive: model.inactiveCanonicalCount ?? 0,
    },
    quality: {
      status: qualityStatus,
      issues,
    },
    computedAt,
    source: 'read_models/dashboard_global',
    sourceAsOf: model.sourceUpdatedAt,
  };
}
