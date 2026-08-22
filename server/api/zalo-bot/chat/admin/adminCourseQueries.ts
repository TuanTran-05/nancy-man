import type { DocumentStore } from '@/server/db/documentStore.js';
import { buildClassTerms } from '../../../../../shared/studentEnrollmentTimeline.js';
import { buildClassTuitionReconciliationReport } from '../../../lib/services/classTuitionReconciliationService.js';
import type {
  AdminClassTuitionResult,
  AdminCoursePeriodResult,
  AdminDataQuality,
  AdminDataQualityIssue,
} from './adminChatTypes.js';
import type { ResolvedClass } from './adminEntityResolver.js';

/**
 * Queries the current course period (start date, end date, label) for a resolved class.
 */
export async function queryAdminClassCoursePeriod(
  db: DocumentStore,
  resolvedClass: ResolvedClass,
  now = new Date()
): Promise<AdminCoursePeriodResult> {
  const computedAt = now.toISOString();
  const classDoc = await db.collection('classes').doc(resolvedClass.classId).get();

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  if (!classDoc.exists) {
    qualityStatus = 'failed';
    issues.push({
      code: 'source_incomplete',
      source: 'classes',
    });

    return {
      kind: 'class_course_period',
      classId: resolvedClass.classId,
      className: resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseId: null,
      courseLabel: 'Chưa có thông tin khóa',
      startDate: null,
      endDate: null,
      isCurrent: false,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'classes_v1',
    };
  }

  const classData = classDoc.data() || {};
  const terms = buildClassTerms({ id: resolvedClass.classId, ...classData });

  const currentTerm = terms.find((t) => t.isCurrent);

  if (!currentTerm) {
    qualityStatus = 'failed';
    issues.push({ code: 'source_incomplete', source: 'canonical_class_terms_v1' });

    return {
      kind: 'class_course_period',
      classId: resolvedClass.classId,
      className: resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseId: null,
      courseLabel: 'Chưa có khóa hiện tại',
      startDate: null,
      endDate: null,
      isCurrent: false,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'classes_v1',
    };
  }

  const courseLabel = `Khóa ${currentTerm.index}`;

  return {
    kind: 'class_course_period',
    classId: resolvedClass.classId,
    className: resolvedClass.className,
    teacherName: resolvedClass.teacherName,
    courseId: currentTerm.termId,
    courseLabel,
    startDate: currentTerm.startDate || null,
    endDate: currentTerm.endDate || null,
    isCurrent: currentTerm.isCurrent,
    quality: {
      status: qualityStatus,
      issues,
    },
    computedAt,
    source: 'canonical_class_terms_v1',
  };
}

/**
 * Queries tuition reconciliation report for a single resolved class on its current course term.
 */
export async function queryAdminClassTuition(
  db: DocumentStore,
  resolvedClass: ResolvedClass,
  now = new Date()
): Promise<AdminClassTuitionResult> {
  const computedAt = now.toISOString();
  const classDoc = await db.collection('classes').doc(resolvedClass.classId).get();

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  if (!classDoc.exists) {
    qualityStatus = 'failed';
    issues.push({
      code: 'source_incomplete',
      source: 'classes',
    });

    return {
      kind: 'class_tuition',
      classId: resolvedClass.classId,
      className: resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseLabel: '',
      expectedGross: null,
      recordedGross: null,
      reductionTotal: null,
      netDueTotal: null,
      paidTotal: null,
      outstandingTotal: null,
      studentCount: null,
      missingLedgerCount: null,
      warningRowCount: null,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'class_tuition_reconciliation_service_v1',
    };
  }

  const classData = classDoc.data() || {};
  const terms = buildClassTerms({ id: resolvedClass.classId, ...classData });
  const currentTerm = terms.find((t) => t.isCurrent);
  const termStart = currentTerm?.startDate;

  if (!termStart) {
    qualityStatus = 'failed';
    issues.push({ code: 'source_incomplete', source: 'canonical_class_terms_v1' });
    return {
      kind: 'class_tuition',
      classId: resolvedClass.classId,
      className: resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseLabel: 'Chưa có khóa hiện tại',
      expectedGross: null,
      recordedGross: null,
      reductionTotal: null,
      netDueTotal: null,
      paidTotal: null,
      outstandingTotal: null,
      studentCount: null,
      missingLedgerCount: null,
      warningRowCount: null,
      quality: { status: qualityStatus, issues },
      computedAt,
      source: 'class_tuition_reconciliation_service_v1',
    };
  }

  try {
    const report = await buildClassTuitionReconciliationReport(db, {
      classId: resolvedClass.classId,
      termStart,
    });

    const sum = report.summary;
    if (sum.missingLedgerCount > 0 || sum.warningRowCount > 0 || report.warnings.length > 0) {
      qualityStatus = 'degraded';
      issues.push({
        code: 'source_incomplete',
        source: 'class_tuition_reconciliation_service_v1',
      });
    }

    return {
      kind: 'class_tuition',
      classId: resolvedClass.classId,
      className: report.scope.className || resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseLabel: report.scope.courseLabel || `Khóa ${termStart}`,
      expectedGross: sum.expectedGross,
      recordedGross: sum.recordedGross,
      reductionTotal: sum.reductionTotal,
      netDueTotal: sum.netDueTotal,
      paidTotal: sum.paidTotal,
      outstandingTotal: sum.outstandingTotal,
      studentCount: sum.studentCount,
      missingLedgerCount: sum.missingLedgerCount,
      warningRowCount: sum.warningRowCount,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'class_tuition_reconciliation_service_v1',
    };
  } catch (err: unknown) {
    qualityStatus = 'failed';
    issues.push({
      code: 'source_incomplete',
      source: 'class_tuition_reconciliation_service_v1',
    });

    return {
      kind: 'class_tuition',
      classId: resolvedClass.classId,
      className: resolvedClass.className,
      teacherName: resolvedClass.teacherName,
      courseLabel: '',
      expectedGross: null,
      recordedGross: null,
      reductionTotal: null,
      netDueTotal: null,
      paidTotal: null,
      outstandingTotal: null,
      studentCount: null,
      missingLedgerCount: null,
      warningRowCount: null,
      quality: {
        status: qualityStatus,
        issues,
      },
      computedAt,
      source: 'class_tuition_reconciliation_service_v1',
    };
  }
}
