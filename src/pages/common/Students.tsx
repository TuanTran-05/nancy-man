import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { Student, SafeStudent, UserProfile, CourseFeeLedger } from '../../types';
import { selectEnrolledStudentRows } from '../../lib/student/currentRecords';
import {
  Plus,
  Trash2,
  Filter,
  Eye,
  Phone,
  Cake,
  FileSpreadsheet,
  Edit2,
  RefreshCw,
  UserCheck,
  Search,
  Users,
  GraduationCap,
  PauseCircle,
  BarChart3,
  ChevronDown,
} from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { isStudentFaceStoragePath, resolveStudentFaceUrl } from '../../lib/student/faceImage';
import { LoadMore, useClientPagination } from '../../components/common/LoadMore';
import { AlignedDropdown } from '../../components/common/AlignedDropdown';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { motion } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 350, damping: 25 } },
};

function StudentTableLoadingRows({ columnCount }: { columnCount: number }) {
  return Array.from({ length: 6 }, (_, index) => (
    <tr key={`student-loading-${index}`} data-testid="student-loading-skeleton" aria-hidden="true">
      <td colSpan={columnCount} className="px-6 py-4">
        <div className="flex items-center gap-6 animate-pulse">
          <div className="h-3 w-20 shrink-0 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="space-y-2">
              <div className="h-3 w-36 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2.5 w-24 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          </div>
          <div className="hidden h-6 w-24 rounded-full bg-slate-100 dark:bg-slate-800 sm:block" />
          <div className="hidden h-6 w-20 rounded-full bg-slate-100 dark:bg-slate-800 md:block" />
          <div className="hidden h-3 w-16 rounded bg-slate-100 dark:bg-slate-800 lg:block" />
        </div>
      </td>
    </tr>
  ));
}

const getStudentInitial = (student: Pick<Student, 'name' | 'studentId' | 'code' | 'id'>) =>
  getStudentDisplayName(student).charAt(0).toUpperCase() || '?';
import { StudentImportModal } from '../../components/students/StudentImportModal';
import Reports from './Reports';
import { cn, toDate } from '../../lib/core/utils';
import { formatVndAmount } from '../../lib/core/moneyFormat';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';
import {
  matchesStudentStatusFilter,
  type StudentStatusFilter,
} from '../../lib/student/statusFilters';
import { ledgerRemaining } from '../../../shared/money';
import { buildStudentSearchRows, getStudentDisplayName } from './studentSearchRows';

import { highlightMatch } from '../../components/common/HighlightMatch';
import { StudentStatusBadge } from './components/students/StudentStatusBadge';
import { useStudentActionModals } from './components/students/StudentActionModals';
import { useStudentDirectoryData } from '../../lib/student/useStudentDirectoryData';
import { formatStudentDate } from '../../lib/student/formatStudentDate';

export function getStudentProfileNavigationTarget(
  student: SafeStudent,
  parentProfiles: UserProfile[],
  parentProfilesLoaded = true
) {
  const parentProfile = parentProfiles.find((p) => p.studentId === student.id);
  // The canonical id when the server sent one, so a row reached through a
  // retired reference still links to the profile that survived rather than
  // sending the user somewhere the page has to redirect away from.
  const profileId = student.canonicalProfileId || student.id;
  return {
    pathname: `/students/${profileId}`,
    options: {
      state: {
        student,
        parentLoginInfo: parentProfilesLoaded
          ? parentProfile
            ? // PostgreSQL API hands back Timestamps for accounts written before the
              // ISO-string convention; router state carries a plain string only.
              { updatedAt: toDate(parentProfile.updatedAt)?.toISOString() ?? null }
            : null
          : undefined,
      },
    },
  };
}

export default function Students() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = translations[language].students;
  const tc = translations[language].common;
  const waitingPromotionStatusLabel = t.waitingPromotion;

  const location = useLocation();
  const navigate = useNavigate();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [faceImageUrls, setFaceImageUrls] = useState<Record<string, string>>({});
  const pendingFaceImageIdsRef = useRef<Set<string>>(new Set());

  const isAdmin = profile?.role === 'admin';
  const isTeacher = profile?.role === 'teacher';
  const isOffice = profile?.role === 'office';
  const isAccounting = profile?.role === 'accounting';
  const hasFullAcademicAccess = isAdmin || isOffice;
  const canViewTuition = isAdmin || isAccounting;
  const canViewGpa = isAdmin || isTeacher;

  const [filterClass, setFilterClass] = useState('all');
  const [filterStatus, setFilterStatus] = useState<StudentStatusFilter>('active');

  const directory = useStudentDirectoryData({
    uid: profile?.uid,
    role: profile?.role,
    classId: isAccounting && filterClass !== 'all' ? filterClass : undefined,
  });
  const {
    students,
    classes,
    teachers,
    parentProfiles,
    parentProfilesLoaded,
    ledgers: tuitionLedgers,
    gradedSubmissions,
    loading,
    loadingRemainingStudents,
    loadingDetails,
  } = directory;

  const isInitialRosterLoading = loading && students.length === 0;
  const tableColumnCount =
    4 + (canViewTuition ? 1 : 0) + (canViewGpa ? 1 : 0) + (!isAccounting ? 1 : 0);
  const tableLoadingMessage = isInitialRosterLoading
    ? t.loadingStudents
    : loadingRemainingStudents
      ? t.loadingMoreStudents.replace('{count}', String(students.length))
      : loadingDetails
        ? t.loadingDetails
        : '';

  useEffect(() => {
    if (directory.error) toast.error(directory.error);
  }, [directory.error]);

  // The embedded monthly report is the heaviest read on this page — one
  // `reports-monthly` request fans out across seven collections server-side and
  // used to block 500px above the table on every mount. It now sits behind a
  // collapsed panel, so arriving on the page costs nothing until someone asks
  // for the report.
  const reportsPanelStorageKey = profile?.uid
    ? `edutrack:students-reports-open:${profile.uid}`
    : null;
  const [isReportsOpen, setIsReportsOpen] = useState(false);

  // Keyed by uid so switching accounts on a shared browser starts from that
  // account's own preference rather than inheriting the previous one.
  useEffect(() => {
    if (!reportsPanelStorageKey) return;
    try {
      setIsReportsOpen(window.localStorage.getItem(reportsPanelStorageKey) === 'true');
    } catch {
      setIsReportsOpen(false);
    }
  }, [reportsPanelStorageKey]);

  const toggleReportsPanel = useCallback(() => {
    const next = !isReportsOpen;
    setIsReportsOpen(next);
    if (!reportsPanelStorageKey) return;
    try {
      window.localStorage.setItem(reportsPanelStorageKey, String(next));
    } catch {
      // Storage is unavailable in private mode; the panel still toggles.
    }
  }, [isReportsOpen, reportsPanelStorageKey]);

  // Even a remembered-open panel waits for the roster, so the table paints
  // first. The flag latches on the first completed load so a later refresh
  // never tears the panel down and pays for that request again.
  const [rosterHasLoadedOnce, setRosterHasLoadedOnce] = useState(false);
  useEffect(() => {
    if (!loading) setRosterHasLoadedOnce(true);
  }, [loading]);

  // One roster refresh re-runs the full student pagination plus the ledger and
  // submission bulk reads, so a double click must not buy two of them.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await directory.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [directory.refresh, isRefreshing]);

  const sortedClasses = useMemo(
    () => sortClassesByTeacherThenName(classes, teachers),
    [classes, teachers]
  );
  const filterableClasses = useMemo(
    () => sortedClasses.filter((classInfo) => classInfo.status !== 'archived'),
    [sortedClasses]
  );
  const classFilterOptions = useMemo(
    () => [
      { value: 'all', label: t.filterAllClasses },
      ...filterableClasses.map((classInfo) => ({
        value: classInfo.id,
        label: formatClassNameWithTeacher(classInfo, teachers),
      })),
    ],
    [filterableClasses, t.filterAllClasses, teachers]
  );
  const statusFilterOptions = useMemo(
    () => [
      { value: 'active', label: t.filterActive },
      { value: 'enrolled', label: t.filterEnrolled },
      { value: 'trial', label: t.filterTrial },
      { value: 'archived', label: t.filterArchived },
      { value: 'on_leave', label: t.filterOnLeave },
      { value: 'dropped', label: t.filterDropped },
      { value: 'promoted', label: waitingPromotionStatusLabel },
      { value: 'all', label: t.messages.allStatus },
    ],
    [
      t.filterActive,
      t.filterArchived,
      t.filterDropped,
      t.filterEnrolled,
      t.filterOnLeave,
      t.filterTrial,
      t.messages.allStatus,
      waitingPromotionStatusLabel,
    ]
  );

  useEffect(() => {
    if (directory.loading) return;
    if (filterClass === 'all') return;
    if (!filterableClasses.some((classInfo) => classInfo.id === filterClass)) {
      setFilterClass('all');
    }
  }, [directory.loading, filterClass, filterableClasses]);

  const tuitionMap = useMemo(() => {
    const map = new Map<string, { status: CourseFeeLedger['status']; remaining: number }>();
    for (const ledger of tuitionLedgers) {
      const remaining = ledgerRemaining(ledger);
      const existing = map.get(ledger.studentId);
      if (!existing) {
        map.set(ledger.studentId, { status: ledger.status, remaining });
        continue;
      }
      existing.remaining += remaining;
      if (existing.status === 'paid' && ledger.status !== 'paid') {
        existing.status = ledger.status;
      }
    }
    return map;
  }, [tuitionLedgers]);

  const gpaMap = useMemo(() => {
    const totals = new Map<string, { sum: number; count: number }>();
    for (const submission of gradedSubmissions) {
      if (typeof submission.grade !== 'number') continue;
      const entry = totals.get(submission.studentId) || { sum: 0, count: 0 };
      entry.sum += submission.grade;
      entry.count += 1;
      totals.set(submission.studentId, entry);
    }
    const map = new Map<string, number>();
    totals.forEach((entry, studentId) => map.set(studentId, entry.sum / entry.count));
    return map;
  }, [gradedSubmissions]);

  const formatVnd = (amount: number) =>
    `${formatVndAmount(amount)} ${language === 'vi' ? 'đ' : 'VND'}`;

  // The rows the server returned, one per human. Collapsing them again here
  // would key on name, date of birth, and contact — the three fields the two
  // documents of a duplicated pair agree on — so it could only ever hide a
  // duplicate, never find one.
  const currentStudents = students;

  // The KPI strip counts the same rows through the status filter, so the strip
  // and the table cannot disagree about who is enrolled.
  const statusCounts = useMemo(() => {
    const enrolled = selectEnrolledStudentRows(students);
    return {
      total: enrolled.length,
      learning: enrolled.filter((student) => matchesStudentStatusFilter(student, 'active')).length,
      trial: enrolled.filter((student) => matchesStudentStatusFilter(student, 'trial')).length,
      onLeave: enrolled.filter((student) => matchesStudentStatusFilter(student, 'on_leave')).length,
    };
  }, [students]);

  const genderLabel = (gender?: string) =>
    gender === 'male' ? t.male : gender === 'female' ? t.female : gender === 'other' ? t.other : '';

  const { pool: poolStudents, rows: searchRows } = useMemo(
    () => buildStudentSearchRows(currentStudents, { searchTerm, filterClass, filterStatus }),
    [currentStudents, searchTerm, filterClass, filterStatus]
  );

  const clientPage = useClientPagination(
    searchRows,
    20,
    `${profile?.uid || ''}|${searchTerm.trim().toLowerCase()}|${filterClass}|${filterStatus}`
  );
  const visibleRows = directory.paginationMode === 'server' ? searchRows : clientPage.shownItems;
  const visibleStudents = useMemo(() => visibleRows.map((row) => row.student), [visibleRows]);

  const getStudentFaceSrc = (student: Student): string => {
    const direct = student.faceImage || '';
    if (direct && !isStudentFaceStoragePath(direct)) return direct;
    return faceImageUrls[student.id] || '';
  };

  const {
    controller: studentActions,
    modals: studentActionModals,
    isAnyOpen,
  } = useStudentActionModals({
    classes,
    sortedClasses,
    filterableClasses,
    teachers,
    resolveFaceSrc: getStudentFaceSrc,
    onChanged: directory.refresh,
    t,
    tc,
  });

  useBodyScrollLock(isImportModalOpen || isAnyOpen);

  const openStudentProfile = useCallback(
    (student: SafeStudent) => {
      const target = getStudentProfileNavigationTarget(
        student,
        parentProfiles,
        parentProfilesLoaded
      );
      navigate(target.pathname, target.options);
    },
    [navigate, parentProfiles, parentProfilesLoaded]
  );

  const seedClassId = location.state?.classId;
  useEffect(() => {
    if (seedClassId) {
      studentActions.openCreate({ classId: seedClassId });
    }
  }, [seedClassId, studentActions.openCreate]);

  useEffect(() => {
    let cancelled = false;
    const missing = visibleStudents.filter((student) => {
      const path =
        student.faceImageStoragePath ||
        (isStudentFaceStoragePath(student.faceImage) ? student.faceImage : '');
      return path && !faceImageUrls[student.id] && !pendingFaceImageIdsRef.current.has(student.id);
    });
    if (missing.length === 0) return;

    missing.forEach((student) => {
      pendingFaceImageIdsRef.current.add(student.id);
      resolveStudentFaceUrl(student.id, student.faceImage, student.faceImageStoragePath)
        .then((url) => {
          if (!cancelled && url) {
            setFaceImageUrls((prev) => (prev[student.id] ? prev : { ...prev, [student.id]: url }));
          }
        })
        .catch(() => {
          // no-op: cleared below regardless of outcome
        })
        .finally(() => {
          // Always clear the pending flag once the request settles, even if
          // this effect run was cancelled — otherwise a student whose fetch
          // resolves after a stray re-render can never be retried.
          pendingFaceImageIdsRef.current.delete(student.id);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [visibleStudents]);

  return (
    <div className="space-y-8 pb-32">
      {/* REPORTS SECTION AT TOP — collapsed by default, loads only on demand */}
      {!isAccounting && (
        <section className="bg-surface rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 overflow-hidden">
          <button
            type="button"
            onClick={toggleReportsPanel}
            aria-expanded={isReportsOpen}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <BarChart3 className="w-5 h-5" />
              </span>
              <span className="font-semibold text-heading truncate">
                {translations[language].reports.title}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'w-5 h-5 text-subtle shrink-0 transition-transform',
                isReportsOpen && 'rotate-180'
              )}
            />
          </button>
          {isReportsOpen && rosterHasLoadedOnce && <Reports embedded={true} />}
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-heading">{t.title}</h1>
          <p className="text-muted">{t.desc}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center space-x-2 border border-border-default bg-surface text-body px-4 py-2 rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            <span>{isRefreshing ? tc.refreshing : tc.refresh}</span>
          </button>
          {!isAccounting && (
            <>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center justify-center space-x-2 border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg font-medium hover:bg-emerald-100 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>{t.importExcel}</span>
              </button>
              <button
                onClick={() => studentActions.openCreate()}
                className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
              >
                <Plus className="w-4 h-4" />
                <span>{t.addStudent}</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-subtle" />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        <AlignedDropdown
          ariaLabel={t.filterAllClasses}
          value={filterClass}
          onChange={setFilterClass}
          options={classFilterOptions}
          align="right"
          placement="top"
          className="w-full md:w-48"
          buttonClassName="border-border-default bg-surface font-normal shadow-none focus:ring-blue-500"
          menuClassName="w-max max-w-[min(28rem,calc(100vw-2rem))]"
          leadingIcon={<Filter className="w-5 h-5 text-subtle" />}
        />
        <AlignedDropdown
          ariaLabel={t.table.status}
          value={filterStatus}
          onChange={(value) => setFilterStatus(value as StudentStatusFilter)}
          options={statusFilterOptions}
          align="right"
          placement="top"
          className="w-full md:w-48"
          buttonClassName="border-border-default bg-surface font-normal shadow-none focus:ring-blue-500"
          leadingIcon={<Filter className="w-5 h-5 text-subtle" />}
        />
      </div>

      {/* Compact KPI strip — roster overview from live status data */}
      {!isAccounting && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: t.kpi.total,
              value: statusCounts.total,
              Icon: Users,
              tint: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
            },
            {
              label: t.kpi.learning,
              value: statusCounts.learning,
              Icon: UserCheck,
              tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
            },
            {
              label: t.kpi.trial,
              value: statusCounts.trial,
              Icon: GraduationCap,
              tint: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
            },
            {
              label: t.kpi.onLeave,
              value: statusCounts.onLeave,
              Icon: PauseCircle,
              tint: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
            },
          ].map(({ label, value, Icon, tint }) => (
            <div
              key={label}
              className="flex items-center gap-3.5 bg-surface rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 px-4 py-3.5"
            >
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tint}`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted uppercase tracking-wide truncate">
                  {label}
                </p>
                <p className="text-2xl font-bold text-heading leading-tight">
                  {isInitialRosterLoading ? (
                    <span
                      data-testid="student-kpi-skeleton"
                      className="mt-1 block h-6 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                    />
                  ) : (
                    value.toLocaleString()
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="bg-surface rounded-2xl border border-border-default shadow-sm dark:shadow-black/20 overflow-hidden"
        aria-busy={Boolean(tableLoadingMessage)}
      >
        {tableLoadingMessage && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-6 py-3 text-sm font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
          >
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
            <span>{tableLoadingMessage}</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-page border-b border-border-light uppercase tracking-wider">
                <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                  {t.table.studentId}
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                  {t.table.name}
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                  {t.table.class}
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                  {t.table.status}
                </th>
                {canViewTuition && (
                  <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                    {t.table.tuition}
                  </th>
                )}
                {canViewGpa && (
                  <th className="px-6 py-4 text-[10px] font-bold text-muted whitespace-nowrap">
                    {t.table.gpa}
                  </th>
                )}
                {!isAccounting && (
                  <th className="px-6 py-4 text-[10px] font-bold text-muted text-right whitespace-nowrap">
                    {t.table.actions}
                  </th>
                )}
              </tr>
            </thead>
            <motion.tbody
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="divide-y divide-slate-100"
            >
              {isInitialRosterLoading && <StudentTableLoadingRows columnCount={tableColumnCount} />}
              {visibleRows.map((row) => {
                const student = row.student;
                const isSiblingRow = row.matchKind === 'sibling';
                const siblingOfName = isSiblingRow
                  ? getStudentDisplayName(
                      poolStudents.find((s) => s.id === row.siblingOf) || student
                    )
                  : '';
                const faceSrc = getStudentFaceSrc(student);
                const displayName = getStudentDisplayName(student);
                const displayDob = formatStudentDate(student.dob);

                return (
                  <motion.tr
                    key={`${row.matchKind}:${student.id}`}
                    variants={rowVariants}
                    whileHover={{
                      scale: 1.008,
                      backgroundColor: 'rgba(59, 130, 246, 0.02)',
                      boxShadow: '0 8px 30px rgba(59, 130, 246, 0.04)',
                      transition: { type: 'spring', stiffness: 400, damping: 25 },
                    }}
                    className="transition-colors duration-150 group cursor-default"
                  >
                    <td className="px-6 py-4">
                      <button
                        onClick={() => openStudentProfile(student)}
                        className="text-[13px] font-bold text-blue-600 hover:text-blue-700 hover:underline uppercase tracking-wide"
                      >
                        {isSiblingRow
                          ? student.studentId
                          : highlightMatch(student.studentId, searchTerm)}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <div
                        className={`flex items-center space-x-3 cursor-pointer ${
                          isSiblingRow ? 'pl-6 border-l-2 border-blue-200' : ''
                        }`}
                        onClick={() => openStudentProfile(student)}
                      >
                        {faceSrc ? (
                          <img
                            src={faceSrc}
                            alt={displayName}
                            className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm dark:shadow-black/20 group-hover:border-blue-200 transition-all"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 font-bold border-2 border-white shadow-sm dark:shadow-black/20">
                            {getStudentInitial(student)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-heading group-hover:text-blue-600 transition-colors truncate">
                            {isSiblingRow ? displayName : highlightMatch(displayName, searchTerm)}
                          </p>
                          {isSiblingRow && (
                            <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                              {t.siblingOfLabel.replace('{name}', siblingOfName)}
                            </span>
                          )}
                          <p className="text-[11px] text-subtle font-medium flex items-center gap-1.5 whitespace-nowrap">
                            {student.contact && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {isSiblingRow
                                  ? student.contact
                                  : highlightMatch(student.contact, searchTerm)}
                              </span>
                            )}
                            {student.contact && genderLabel(student.gender) && (
                              <span className="text-border-default">·</span>
                            )}
                            {genderLabel(student.gender) && (
                              <span>{genderLabel(student.gender)}</span>
                            )}
                            {(student.contact || genderLabel(student.gender)) && displayDob && (
                              <span className="text-border-default">·</span>
                            )}
                            {displayDob && (
                              <span className="inline-flex items-center gap-1">
                                <Cake className="w-3 h-3" />
                                {displayDob}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block whitespace-nowrap px-3 py-1 bg-blue-50 dark:bg-blue-500/10 text-blue-600 text-[11px] font-bold rounded-full uppercase tracking-tight">
                        {classes.find((c) => c.id === student.classId)?.name || t.messages.unknown}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StudentStatusBadge
                        student={student}
                        t={t}
                        waitingPromotionStatusLabel={waitingPromotionStatusLabel}
                      />
                    </td>
                    {canViewTuition &&
                      (() => {
                        const tuition = tuitionMap.get(student.id);
                        if (!tuition) {
                          return (
                            <td className="px-6 py-4">
                              <span className="text-xs text-subtle">—</span>
                            </td>
                          );
                        }
                        const tint =
                          tuition.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : tuition.status === 'waived'
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400'
                              : tuition.status === 'partial'
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400';
                        return (
                          <td className="px-6 py-4">
                            <div className="space-y-0.5">
                              <span
                                className={`inline-block whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-semibold ${tint}`}
                              >
                                {t.tuitionStatus[tuition.status] || tuition.status}
                              </span>
                              {tuition.remaining > 0 && (
                                <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium whitespace-nowrap">
                                  {t.tuitionStatus.owedPrefix} {formatVnd(tuition.remaining)}
                                </p>
                              )}
                            </div>
                          </td>
                        );
                      })()}
                    {canViewGpa &&
                      (() => {
                        const gpa = gpaMap.get(student.id);
                        return (
                          <td className="px-6 py-4">
                            {typeof gpa === 'number' ? (
                              <div className="flex items-center gap-2 min-w-[110px]">
                                <span className="text-sm font-bold text-heading w-8 shrink-0">
                                  {gpa.toFixed(1)}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{ width: `${Math.min(100, (gpa / 10) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-subtle">—</span>
                            )}
                          </td>
                        );
                      })()}
                    {!isAccounting && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => openStudentProfile(student)}
                            title={t.viewDetails}
                            className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-all"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => studentActions.openStatus(student)}
                            title={t.statusModal.title}
                            className="p-2 text-subtle hover:text-emerald-600 hover:bg-emerald-50 dark:bg-emerald-500/10 rounded-lg transition-all"
                          >
                            <UserCheck className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => studentActions.openEdit(student)}
                            className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {hasFullAcademicAccess && (
                            <button
                              onClick={() => studentActions.openTransfer(student)}
                              title="Chuyển lớp"
                              className="p-2 text-subtle hover:text-blue-600 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-all"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => studentActions.openDelete(student.id)}
                              className="p-2 text-subtle hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </motion.tr>
                );
              })}
              {searchRows.length === 0 && !loading && !loadingRemainingStudents && (
                <tr>
                  <td
                    colSpan={tableColumnCount}
                    className="px-6 py-12 text-center text-subtle italic"
                  >
                    {t.messages.noStudentsFound}
                  </td>
                </tr>
              )}
            </motion.tbody>
          </table>
        </div>
        {directory.paginationMode === 'client' ? (
          <LoadMore
            hasMore={clientPage.hasMore}
            loading={false}
            onLoadMore={clientPage.loadMore}
            totalShown={clientPage.totalShown}
            totalAvailable={clientPage.totalAvailable}
          />
        ) : (
          directory.hasMoreServer && (
            <div className="flex justify-center border-t border-border-light px-6 py-4">
              <button
                type="button"
                onClick={() => void directory.loadMoreServer()}
                disabled={directory.loadingMore}
                className="px-4 py-2 rounded-lg bg-surface border border-border-default text-sm font-medium text-heading hover:bg-page disabled:opacity-60"
              >
                {directory.loadingMore ? tc.loadMore.loading : tc.loadMore.loadMore}
              </button>
            </div>
          )
        )}
      </div>

      <StudentImportModal open={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} />

      {studentActionModals}
    </div>
  );
}
