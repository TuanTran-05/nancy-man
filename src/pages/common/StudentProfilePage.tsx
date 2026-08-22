import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { AlertCircle, Edit2, PauseCircle, RefreshCw, Trash2, UserCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import type { SafeStudent } from '../../types';
import type { StudentTimelineSegment } from '../../lib/api/studentAdminReportApi';
import { ALL, filterStudentReport, type ReportFilter } from '../../lib/reports/studentReportFilter';
import { selectTermSessionValue } from '../../lib/reports/selectTermSessionValue';
import { canonicalProfileRedirect } from '../../lib/student/canonicalProfileRoute';
import {
  getVisibleStudentProfileTabs,
  resolveStudentProfileTab,
  type StudentProfileTab,
} from '../../lib/student/studentProfileTabs';
import {
  type ParentLoginInfo,
  useStudentProfileData,
} from '../../lib/student/useStudentProfileData';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import { isStudentFaceStoragePath, resolveStudentFaceUrl } from '../../lib/student/faceImage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { StudentReportHeader } from '../admin/components/studentReport/StudentReportHeader';
import { StudentReportKpis } from '../admin/components/studentReport/StudentReportKpis';
import { StudentReportTimelineStrip } from '../admin/components/studentReport/StudentReportTimelineStrip';
import { StudentReportFilters } from '../admin/components/studentReport/StudentReportFilters';
import { StudentAttendanceReportTab } from '../admin/components/studentReport/StudentAttendanceReportTab';
import { StudentFinanceReportTab } from '../admin/components/studentReport/StudentFinanceReportTab';
import { StudentOverviewTab } from './studentProfile/StudentOverviewTab';
import { useStudentActionModals } from './components/students/StudentActionModals';

type StudentProfileLocationState = {
  student?: SafeStudent;
  parentLoginInfo?: ParentLoginInfo | null;
} | null;

function getVietnamTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function defaultFilter(
  timeline: StudentTimelineSegment[],
  currentClassId: string | null
): ReportFilter {
  const current =
    (currentClassId
      ? timeline.find((s) => s.classId === currentClassId && s.term.isCurrent)
      : undefined) ??
    [...timeline].reverse().find((s) => s.term.isCurrent) ??
    timeline[timeline.length - 1];

  if (!current) return { classId: ALL, termKey: ALL };
  return { classId: current.classId, termKey: current.key };
}

function getTabLabel(tab: StudentProfileTab, t: any): string {
  if (tab === 'overview') return t.tabs.overview;
  if (tab === 'academic') return t.tabs.academic;
  return t.tabs.finance;
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]" id="student-report-loading">
      <div className="flex flex-col items-center gap-3 text-muted">
        <RefreshCw className="w-7 h-7 animate-spin" />
        <p>{label}</p>
      </div>
    </div>
  );
}

export default function StudentProfilePage() {
  const { studentId = '' } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as StudentProfileLocationState;
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = (translations[language as keyof typeof translations] || translations.vi)
    .studentAdminReportPage;
  const tStudents = (translations[language as keyof typeof translations] || translations.vi)
    .students;
  const tc = (translations[language as keyof typeof translations] || translations.vi).common;

  const data = useStudentProfileData({
    studentId,
    role: profile?.role,
    seedStudent: locationState?.student,
    seedParentLogin: locationState?.parentLoginInfo,
  });

  const [filter, setFilter] = useState<ReportFilter | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvedFaceUrl, setResolvedFaceUrl] = useState('');

  const visibleTabs = useMemo(() => getVisibleStudentProfileTabs(profile?.role), [profile?.role]);
  const activeTab = resolveStudentProfileTab(
    searchParams.get('tab') || (profile?.role === 'accounting' ? 'finance' : null),
    visibleTabs
  );
  const selectTab = useCallback(
    (tab: StudentProfileTab) => {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    setFilter(null);
  }, [studentId]);

  // A link written before a merge names a profile that no longer exists. The
  // server resolves it forward and answers, but leaving the retired id in the
  // address bar means it gets bookmarked and shared again. `replace` because
  // the retired URL is not somewhere the user chose to be.
  useEffect(() => {
    const target = canonicalProfileRedirect({
      requestedStudentId: studentId,
      canonicalProfileId: data.report?.canonicalProfileId,
      search: location.search,
    });
    if (target) navigate(target, { replace: true, state: location.state });
  }, [data.report?.canonicalProfileId, location.search, location.state, navigate, studentId]);

  useEffect(() => {
    if (!data.report) return;
    setFilter(
      (prev) =>
        prev ??
        (() => {
          const requestedClassId = searchParams.get('classId');
          const requestedTermKey = searchParams.get('termKey');
          const requested =
            requestedClassId || requestedTermKey
              ? data.report.timeline.find(
                  (segment) =>
                    (!requestedClassId || segment.classId === requestedClassId) &&
                    (!requestedTermKey || segment.key === requestedTermKey)
                )
              : undefined;
          return requested
            ? { classId: requested.classId, termKey: requested.key }
            : defaultFilter(
                data.report.timeline,
                typeof data.report.student.classId === 'string' ? data.report.student.classId : null
              );
        })()
    );
  }, [data.report]);

  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(data.classes, data.teachers),
    [data.classes, data.teachers]
  );
  const filterableClasses = useMemo(
    () => sortedClasses.filter((classInfo) => classInfo.status !== 'archived'),
    [sortedClasses]
  );

  const classLabel = useMemo(() => {
    const student = data.student;
    if (!student) return 'N/A';
    const classInfo = sortedClasses.find((classRow) => classRow.id === student.classId);
    if (classInfo) return formatClassNameWithTeacher(classInfo, data.teachers);
    const timelineClass = data.report?.timeline.find(
      (segment) => segment.classId === student.classId
    )?.className;
    return timelineClass || student.classId || 'N/A';
  }, [data.report, data.student, data.teachers, sortedClasses]);

  useEffect(() => {
    const student = data.student;
    let cancelled = false;
    setResolvedFaceUrl('');
    if (!student) return;
    resolveStudentFaceUrl(student.id, student.faceImage, student.faceImageStoragePath)
      .then((url) => {
        if (!cancelled) setResolvedFaceUrl(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedFaceUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [data.student?.faceImage, data.student?.faceImageStoragePath, data.student?.id]);

  const resolveFaceSrc = useCallback(
    (student: SafeStudent) => {
      if (student.id === data.student?.id && resolvedFaceUrl) return resolvedFaceUrl;
      const direct = student.faceImage || '';
      if (direct && !isStudentFaceStoragePath(direct)) return direct;
      return '';
    },
    [data.student?.id, resolvedFaceUrl]
  );

  const actionModals = useStudentActionModals({
    classes: data.classes,
    sortedClasses,
    filterableClasses,
    teachers: data.teachers,
    resolveFaceSrc,
    onChanged: data.reload,
    t: tStudents,
    tc,
  });
  useBodyScrollLock(actionModals.isAnyOpen);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await data.reload().catch(() => {});
    setIsRefreshing(false);
  };

  const todayStr = getVietnamTodayStr();
  const effectiveFilter: ReportFilter = filter ?? { classId: ALL, termKey: ALL };

  const filtered = useMemo(
    () => (data.report ? filterStudentReport(data.report, effectiveFilter, todayStr) : null),
    [data.report, effectiveFilter, todayStr]
  );

  const activeKey = filtered && filtered.segments.length === 1 ? filtered.segments[0].key : null;
  const sessionValue = selectTermSessionValue(
    data.report?.sessionValueByTerm ?? {},
    effectiveFilter
  );
  const refundableAmount =
    sessionValue?.pricePerSession === null ? null : (sessionValue?.refundable.amount ?? null);
  const classMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const segment of data.report?.timeline ?? []) {
      if (segment.className) map[segment.classId] = segment.className;
    }
    return map;
  }, [data.report]);

  if (data.loading && !data.student) {
    return <LoadingState label={t.loadingLabel} />;
  }

  if (data.notFound) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" id="student-report-not-found">
        <div className="flex flex-col items-center gap-3 text-muted text-center">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <p className="font-semibold">{t.notFoundLabel}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-2 text-sm text-indigo-600 hover:underline"
          >
            {t.backLabel}
          </button>
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" id="student-report-error">
        <div className="flex flex-col items-center gap-3 text-muted text-center">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <p>{data.error}</p>
          <button
            onClick={() => void data.reload()}
            className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            {t.retryLabel}
          </button>
        </div>
      </div>
    );
  }

  if (!data.student) return null;

  const studentName = typeof data.student.name === 'string' ? data.student.name : '';
  const studentCode = typeof data.student.studentId === 'string' ? data.student.studentId : '';
  const canMutate = profile?.role === 'admin' || profile?.role === 'office';
  const canDelete = profile?.role === 'admin';

  return (
    <div className="max-w-6xl mx-auto px-4 py-6" id="student-profile-page">
      <StudentReportHeader
        studentName={studentName}
        studentCode={studentCode}
        studentStatus={
          typeof data.student.enrollmentStatus === 'string' ? data.student.enrollmentStatus : ''
        }
        onBack={() => navigate(-1)}
        onRefresh={handleRefresh}
        generatedAt={data.report?.generatedAt ?? null}
        isRefreshing={isRefreshing}
        t={t}
      />

      {canMutate && (
        <div className="mb-5 flex flex-wrap justify-end gap-2" id="student-profile-actions">
          <button
            type="button"
            data-testid="student-profile-action-edit"
            onClick={() => actionModals.controller.openEdit(data.student!)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-light px-3 py-2 text-sm font-semibold text-heading hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Edit2 className="h-4 w-4" />
            {tStudents.saveChanges}
          </button>
          <button
            type="button"
            data-testid="student-profile-action-status"
            onClick={() => actionModals.controller.openStatus(data.student!)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-light px-3 py-2 text-sm font-semibold text-heading hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <PauseCircle className="h-4 w-4" />
            {tStudents.changeStatus}
          </button>
          <button
            type="button"
            data-testid="student-profile-action-transfer"
            onClick={() => actionModals.controller.openTransfer(data.student!)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-light px-3 py-2 text-sm font-semibold text-heading hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <UserCheck className="h-4 w-4" />
            {tStudents.modal.classLabel}
          </button>
          {canDelete && (
            <button
              type="button"
              data-testid="student-profile-action-delete"
              onClick={() => actionModals.controller.openDelete(data.student!.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" />
              {tStudents.messages.deleteBtn}
            </button>
          )}
        </div>
      )}

      {data.report &&
        (data.report.truncation.attendance ||
          data.report.truncation.ledgers ||
          data.report.truncation.classSessions) && (
          <div
            id="report-truncated-warning"
            data-testid="report-truncated-warning"
            className="mb-4 px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-sm text-amber-700 dark:text-amber-300 font-medium"
          >
            ⚠️ {t.timeline.truncatedWarning}
          </div>
        )}

      <div className="flex gap-1 mb-6 border-b border-border-light" id="student-profile-tabs">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            data-testid={`tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => selectTab(tab)}
            className={`px-5 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-muted hover:text-heading'
            }`}
          >
            {getTabLabel(tab, t)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <StudentOverviewTab
          student={data.student}
          classLabel={classLabel}
          parentLoginInfo={data.parentLoginInfo}
          language={language}
          t={tStudents}
          siblings={data.siblings}
          siblingCandidates={data.siblingCandidates}
          canEditSiblings={canMutate}
          onSiblingsChanged={data.reload}
        />
      )}

      {activeTab === 'academic' &&
        (data.report && filtered ? (
          <>
            <StudentReportTimelineStrip
              segments={data.report.timeline}
              activeKey={activeKey}
              onSelect={(segment) =>
                setFilter((prev) => ({
                  classId: segment.classId,
                  termKey: segment.key,
                  from: prev?.from,
                  to: prev?.to,
                }))
              }
              t={t}
            />

            <StudentReportFilters
              timeline={data.report.timeline}
              filter={effectiveFilter}
              onChange={setFilter}
              t={t}
            />

            {profile?.role !== 'accounting' && (
              <StudentReportKpis
                attendanceSummary={filtered.attendanceSummary}
                financeSummary={filtered.financeSummary}
                attendanceMode={filtered.attendanceMode}
                refundableAmount={refundableAmount}
                t={t}
              />
            )}

            <StudentAttendanceReportTab
              rows={filtered.attendanceRows}
              classMap={classMap}
              showClassName={effectiveFilter.classId === ALL}
              attendanceMode={filtered.attendanceMode}
              todayIso={todayStr}
              dateRangeFrom={effectiveFilter.from}
              dateRangeTo={effectiveFilter.to}
              sessionValue={sessionValue}
              t={t}
            />
          </>
        ) : (
          <LoadingState label={t.loadingLabel} />
        ))}

      {activeTab === 'finance' &&
        (data.report && filtered ? (
          <>
            <StudentReportKpis
              attendanceSummary={filtered.attendanceSummary}
              financeSummary={filtered.financeSummary}
              attendanceMode={filtered.attendanceMode}
              refundableAmount={refundableAmount}
              t={t}
            />
            <StudentFinanceReportTab
              financeSummary={filtered.financeSummary}
              ledgers={filtered.ledgers}
              receipts={data.report.receipts}
              courseSummaries={filtered.courseSummaries}
              canCorrectEnrollment={profile?.role === 'admin' || profile?.role === 'office'}
              onEnrollmentCorrected={data.reload}
              t={t}
            />
          </>
        ) : (
          <LoadingState label={t.loadingLabel} />
        ))}

      {actionModals.modals}
    </div>
  );
}
