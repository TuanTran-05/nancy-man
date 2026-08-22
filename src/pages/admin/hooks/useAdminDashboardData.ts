import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { apiRequest } from '../../../lib/api/apiClient';
import { readChannel } from '../../../lib/api/readApi';
import { selectAdminHeadcount } from './adminHeadcount';
import type { DashboardReadModelV3 } from '../../../../shared/dashboardReadModel';
import { getStudentDirectory } from '../../../lib/api/studentDirectoryApi';
import { standardizeStudentIdsInBatches } from '../../../lib/api/studentAdminApi';
import { buildClassStudentCounts } from '../../../lib/student/classStudentCounts';
import { logAuditActivity } from '../../../lib/audit/auditLog';
import { fetchFinanceReport, type FinanceReport } from '../../../lib/api/financeApi';
import { FRONTEND_COLLECTION_LIMIT } from '../../../lib/api/readLimits';
import { useInvalidationRefresh } from '../../../hooks/useInvalidationRefresh';
import type { AuditLogEntry } from '../../../types';
import { translations } from '../../../lib/i18n/translations';
import { type AdminStaffProfile, isAdminStaffRole } from '../../../lib/auth/staffRoles';
import {
  getAuditActorParts,
  getAuditLookupName,
  getAuditInitial,
} from '../../../lib/audit/auditHelpers';
import { Bell, BookOpen, Users, Database } from 'lucide-react';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../../../lib/api/frontendReadApi';

export interface AllowedTeacher {
  email: string;
  addedAt: string;
}

export interface BlockedTeacher {
  email: string;
  blockedAt: string;
}

export type StaffProfile = AdminStaffProfile;
export type TeacherProfile = StaffProfile;

export interface AuditUserLookup {
  displayName?: string;
  email?: string;
  role?: string;
}

export type ClassStudentCounts = Record<
  string,
  { total: number; active: number; onLeave: number; dropped: number; promoted?: number }
>;

export interface AdminDashboardProjection {
  summary?: {
    totalStudents?: number;
    activeStudents?: number;
    totalTeachers?: number;
    totalClasses?: number;
    activeClasses?: number;
  };
  students?: any[];
  classes?: any[];
  staff?: StaffProfile[];
  teachers?: StaffProfile[];
  evaluations?: any[];
  classStudentCounts?: ClassStudentCounts;
  performanceCounts?: { excellent: number; good: number; fair: number; average: number };
  /**
   * Enrollment-derived headcount, present from `canonical_preferred`. Carries
   * its own `generatedAt` so a stale stored aggregate can be told apart from a
   * fresh one — see `selectAdminHeadcount`.
   */
  canonicalHeadcount?: DashboardReadModelV3;
}

export function useAdminDashboardData(isAdmin: boolean, language: keyof typeof translations) {
  const t = translations[language].adminDashboard;
  const ap = translations[language].adminPage;
  const staffAccessCopy = t.staffTab || t.teachersTab;

  const [allowedTeachers, setAllowedTeachers] = useState<AllowedTeacher[]>([]);
  const [blockedTeachers, setBlockedTeachers] = useState<BlockedTeacher[]>([]);
  const [registeredTeachers, setRegisteredTeachers] = useState<TeacherProfile[]>([]);
  const [registeredStaff, setRegisteredStaff] = useState<StaffProfile[]>([]);
  const [selectedStaffProfile, setSelectedStaffProfile] = useState<TeacherProfile | null>(null);
  const [fundReport, setFundReport] = useState<FinanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFrom, setReportFrom] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditUserMap, setAuditUserMap] = useState<Record<string, AuditUserLookup>>({});
  const [classes, setClasses] = useState<any[]>([]);
  const [studentRecords, setStudentRecords] = useState<any[]>([]);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [performanceCounts, setPerformanceCounts] =
    useState<AdminDashboardProjection['performanceCounts']>();
  const [studentsCount, setStudentsCount] = useState(0);
  const [activeStudentsTotal, setActiveStudentsTotal] = useState<number | null>(null);
  const [classStudentCounts, setClassStudentCounts] = useState<ClassStudentCounts>({});
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const dashboardRequestIdRef = useRef(0);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isStandardizing, setIsStandardizing] = useState(false);

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [confirmDelete]);

  // Fund report
  const handleLoadFundReport = useCallback(
    async (from?: string, to?: string) => {
      setReportLoading(true);
      try {
        const data = await fetchFinanceReport(from || reportFrom, to || reportTo);
        setFundReport(data);
      } catch (err) {
        console.error('Error loading fund report:', err);
        toast.error(ap.loadReportFailed);
      } finally {
        setReportLoading(false);
      }
    },
    [reportFrom, reportTo, ap.loadReportFailed]
  );

  const loadDashboardSummary = useCallback(
    async (options: { revalidateDirectory?: boolean; showLoading?: boolean } = {}) => {
      if (!isAdmin) return;
      const requestId = ++dashboardRequestIdRef.current;
      if (options.showLoading) setLoading(true);

      try {
        const [data, directory] = await Promise.all([
          readChannel<AdminDashboardProjection>('admin-dashboard-summary'),
          options.revalidateDirectory
            ? getStudentDirectory({ revalidate: true })
            : getStudentDirectory(),
        ]);
        if (requestId !== dashboardRequestIdRef.current) return;

        const allStudents = directory.students || [];
        const headcount = selectAdminHeadcount(data);
        const staff = (data.staff || data.teachers || []).filter((user) =>
          isAdminStaffRole(user.role)
        );
        const teachers = staff.filter((user) => user.role === 'teacher');
        setStudentRecords(allStudents as any[]);
        setStudentsCount(headcount.total);
        setActiveStudentsTotal(headcount.active);
        setClassStudentCounts(data.classStudentCounts || buildClassStudentCounts(allStudents));
        setRegisteredTeachers(teachers);
        setRegisteredStaff(staff);
        setClasses(data.classes || []);
        setEvaluations(data.evaluations || []);
        setPerformanceCounts(data.performanceCounts);
        setAuditUserMap((prev) => ({
          ...prev,
          ...Object.fromEntries(
            staff.map((staffMember) => [
              staffMember.uid,
              {
                displayName: staffMember.displayName,
                email: staffMember.email,
                role: staffMember.role,
              },
            ])
          ),
        }));
      } catch (error) {
        if (requestId === dashboardRequestIdRef.current) {
          console.error('Error loading admin dashboard summary:', error);
        }
      } finally {
        if (requestId === dashboardRequestIdRef.current) setLoading(false);
      }
    },
    [isAdmin]
  );

  useInvalidationRefresh({
    channelKey: 'students',
    enabled: isAdmin,
    onInvalidate: () => loadDashboardSummary({ revalidateDirectory: true }),
  });

  useEffect(() => {
    let cancelled = false;
    const loadStaffAccess = async () => {
      if (!isAdmin) return;
      try {
        const data = await readChannel<{
          allowedTeachers: AllowedTeacher[];
          blockedTeachers: BlockedTeacher[];
        }>('admin-access-config', { limit: FRONTEND_COLLECTION_LIMIT });
        if (cancelled) return;
        setAllowedTeachers(data.allowedTeachers || []);
        setBlockedTeachers(data.blockedTeachers || []);
      } catch (error) {
        if (!cancelled) console.error('Error loading staff access configuration:', error);
      }
    };
    void loadStaffAccess();
    const staffAccessInterval = window.setInterval(
      () => void loadStaffAccess(),
      FRONTEND_READ_POLL_INTERVAL_MS
    );

    if (isAdmin) {
      void loadDashboardSummary({ showLoading: true });
    } else {
      setLoading(false);
    }

    // Fetch audit-log (admin only)
    if (isAdmin) {
      (async () => {
        try {
          const auditData = await readChannel<{
            logs: AuditLogEntry[];
            users?: Record<string, AuditUserLookup>;
          }>('audit-log', { limit: 100 });
          if (cancelled) return;
          setAuditLogs(auditData.logs || []);
          if (auditData.users) setAuditUserMap((prev) => ({ ...prev, ...auditData.users }));
        } catch (error) {
          console.error('Error loading audit log data:', error);
        }
      })();
    }

    return () => {
      dashboardRequestIdRef.current += 1;
      cancelled = true;
      window.clearInterval(staffAccessInterval);
    };
  }, [isAdmin, loadDashboardSummary]);

  // Load fund report on mount (admin only)
  useEffect(() => {
    if (isAdmin) {
      handleLoadFundReport();
    }
  }, [isAdmin, handleLoadFundReport]);

  const downloadAdminFile = useCallback(async (path: string, fallbackFilename: string) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text || `Download failed (${response.status})`;
      try {
        const data = JSON.parse(text);
        if (typeof data.error === 'string' && data.error.trim()) message = data.error;
      } catch {
        // Keep raw server text as fallback.
      }
      throw new Error(message);
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameMatch?.[1] || fallbackFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportSQL = useCallback(async () => {
    const reason = window.prompt(ap.exportReasonPrompt)?.trim() || '';
    if (reason.length < 3) {
      toast.error(ap.exportReasonRequired);
      return;
    }
    setIsExporting(true);
    try {
      await downloadAdminFile(
        `/api/v1/audit/export-sql?reason=${encodeURIComponent(reason)}`,
        `edutrack_export_${new Date().toISOString().split('T')[0]}.sql`
      );
    } catch (err) {
      console.error('Export error:', err);
      toast.error(t.settingsTab.exportError);
    } finally {
      setIsExporting(false);
    }
  }, [
    ap.exportReasonPrompt,
    ap.exportReasonRequired,
    downloadAdminFile,
    t.settingsTab.exportError,
  ]);

  const handleExportExcel = useCallback(async () => {
    const reason = window.prompt(ap.exportReasonPrompt)?.trim() || '';
    if (reason.length < 3) {
      toast.error(ap.exportReasonRequired);
      return;
    }
    setIsExporting(true);
    try {
      await downloadAdminFile(
        `/api/v1/audit/export-excel?reason=${encodeURIComponent(reason)}`,
        `edutrack_export_${new Date().toISOString().split('T')[0]}.xml`
      );
      toast.success(ap.excelExportSuccess);
    } catch (err) {
      console.error('Export error:', err);
      toast.error(ap.exportDataError);
    } finally {
      setIsExporting(false);
    }
  }, [
    ap.exportReasonPrompt,
    ap.exportReasonRequired,
    downloadAdminFile,
    ap.excelExportSuccess,
    ap.exportDataError,
  ]);

  const handleStandardizeStudentIds = useCallback(async () => {
    if (
      isStandardizing ||
      !window.confirm(`${ap.standardizeStudentsConfirm} ${ap.standardizeStudentsSkipped}`)
    ) {
      return;
    }

    setIsStandardizing(true);
    const toastId = toast.loading(ap.standardizeStudentIdLoading);
    try {
      const data = await standardizeStudentIdsInBatches({ batchSize: 100 });
      toast.success(ap.standardizeStudentsSuccess.replace('{count}', data.updated.toString()), {
        id: toastId,
      });
    } catch (error) {
      console.error('Standardization error:', error);
      toast.error(ap.standardizeError, {
        id: toastId,
      });
    } finally {
      setIsStandardizing(false);
    }
  }, [
    isStandardizing,
    ap.standardizeStudentsConfirm,
    ap.standardizeStudentsSkipped,
    ap.standardizeStudentIdLoading,
    ap.standardizeStudentsSuccess,
    ap.standardizeError,
  ]);

  const handleStandardizeTeacherIds = useCallback(async () => {
    if (
      isStandardizing ||
      !window.confirm(`${ap.standardizeTeachersConfirm} ${ap.standardizeTeachersSkipped}`)
    ) {
      return;
    }

    setIsStandardizing(true);
    const toastId = toast.loading(ap.standardizeTeacherIdLoading);
    try {
      const data = await apiRequest<{ success: boolean; updated: number }>(
        '/api/v1/auth/staff-standardize-teacher-ids',
        {
          method: 'POST',
        }
      );
      toast.success(ap.standardizeTeachersSuccess.replace('{count}', data.updated.toString()), {
        id: toastId,
      });
    } catch (error) {
      console.error('Standardization error:', error);
      toast.error(ap.standardizeError, {
        id: toastId,
      });
    } finally {
      setIsStandardizing(false);
    }
  }, [
    isStandardizing,
    ap.standardizeTeachersConfirm,
    ap.standardizeTeachersSkipped,
    ap.standardizeTeacherIdLoading,
    ap.standardizeTeachersSuccess,
    ap.standardizeError,
  ]);

  const handleAddEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newEmail.trim() || actionLoading) return;

      const email = newEmail.trim().toLowerCase();
      setActionLoading(email);
      try {
        await apiRequest('/api/v1/auth/staff-add-email', {
          method: 'POST',
          body: { email },
        });
        await logAuditActivity('create', 'allowed_teachers', email, undefined, { email });
        setNewEmail('');
        toast.success(translations[language].common.success);
      } catch (err) {
        console.error('Error adding email:', err);
        toast.error(staffAccessCopy.errorAdd);
      } finally {
        setActionLoading(null);
      }
    },
    [newEmail, actionLoading, language, staffAccessCopy.errorAdd]
  );

  const handleRemoveEmail = useCallback(
    async (email: string) => {
      if (actionLoading) return;

      setActionLoading(email);
      const promise = (async () => {
        await apiRequest('/api/v1/auth/staff-remove-email', {
          method: 'POST',
          body: { email },
        });
        await logAuditActivity('update', 'users', email, undefined, {
          action: 'revoke_access',
          blocked: true,
          email,
        });
      })();

      toast.promise(promise, {
        loading: ap.revokeAccessLoading,
        success: ap.revokeAccessSuccess,
        error: ap.revokeAccessError,
      });

      try {
        await promise;
      } catch (err) {
        console.error('Error removing email:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [actionLoading, ap.revokeAccessLoading, ap.revokeAccessSuccess, ap.revokeAccessError]
  );

  const handleUnblockEmail = useCallback(
    async (email: string) => {
      if (actionLoading) return;

      setActionLoading(email);
      const promise = (async () => {
        await apiRequest('/api/v1/auth/staff-unblock-email', {
          method: 'POST',
          body: { email },
        });
        await logAuditActivity('update', 'users', email, undefined, {
          action: 'unblock_access',
          blocked: false,
          email,
        });
      })();

      toast.promise(promise, {
        loading: ap.unblockLoading,
        success: ap.unblockSuccess,
        error: ap.unblockError,
      });

      try {
        await promise;
      } catch (err) {
        console.error('Error unblocking email:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [actionLoading, ap.unblockLoading, ap.unblockSuccess, ap.unblockError]
  );

  const handleDeleteUserAccount = useCallback(
    async (uid: string, email?: string) => {
      if (actionLoading) return;

      if (confirmDelete !== uid) {
        setConfirmDelete(uid);
        return;
      }

      setConfirmDelete(null);
      setActionLoading(uid);
      const promise = (async () => {
        await apiRequest('/api/v1/auth/staff-delete-account', {
          method: 'POST',
          body: { uid, email: email || '' },
        });
        await logAuditActivity('delete', 'users', uid, undefined, { email });
      })();

      toast.promise(promise, {
        loading: ap.deleteAccountLoading,
        success: ap.deleteAccountSuccess,
        error: ap.deleteAccountError,
      });

      try {
        await promise;
      } catch (err) {
        console.error('Error deleting user account:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [
      actionLoading,
      confirmDelete,
      ap.deleteAccountLoading,
      ap.deleteAccountSuccess,
      ap.deleteAccountError,
    ]
  );

  const handleDeleteBlockedEmail = useCallback(
    async (email: string) => {
      if (actionLoading) return;

      const emailLower = email.toLowerCase();
      if (confirmDelete !== emailLower) {
        setConfirmDelete(emailLower);
        return;
      }

      setConfirmDelete(null);
      setActionLoading(email);
      const promise = (async () => {
        await apiRequest('/api/v1/auth/staff-delete-blocked-email', {
          method: 'POST',
          body: { email },
        });
        await logAuditActivity('delete', 'blocked_teachers', email.toLowerCase(), undefined, {
          email: email.toLowerCase(),
        });
      })();

      toast.promise(promise, {
        loading: ap.deletePermanentlyLoading,
        success: ap.deletePermanentlySuccess,
        error: ap.deletePermanentlyError,
      });

      try {
        await promise;
      } catch (err) {
        console.error('Error deleting blocked email:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [
      actionLoading,
      confirmDelete,
      ap.deletePermanentlyLoading,
      ap.deletePermanentlySuccess,
      ap.deletePermanentlyError,
    ]
  );

  const memoizedValues = useMemo(() => {
    const projectedActive = studentRecords.filter(
      (student) => (student.enrollmentStatus || 'active') === 'active'
    ).length;
    const activeCount = activeStudentsTotal ?? projectedActive;
    const rateActive = studentsCount > 0 ? Math.round((activeCount / studentsCount) * 100) : 0;
    const gender = [
      {
        label: ap.male,
        value: studentRecords.filter((student) => student.gender === 'male').length,
        color: '#2563eb',
      },
      {
        label: ap.female,
        value: studentRecords.filter((student) => student.gender === 'female').length,
        color: '#ec4899',
      },
      {
        label: ap.other,
        value: studentRecords.filter((student) => student.gender === 'other' || !student.gender)
          .length,
        color: '#cbd5e1',
      },
    ];
    const latestEvaluationByStudent = new Map<string, any>();
    evaluations.forEach((evaluation) => {
      const current = latestEvaluationByStudent.get(evaluation.studentId);
      if (!current || new Date(evaluation.date).getTime() > new Date(current.date).getTime()) {
        latestEvaluationByStudent.set(evaluation.studentId, evaluation);
      }
    });
    const perfRows = [
      {
        label: ap.excellent,
        color: '#10b981',
        value: performanceCounts?.excellent || 0,
      },
      {
        label: ap.good,
        color: '#0ea5e9',
        value: performanceCounts?.good || 0,
      },
      {
        label: ap.fair,
        color: '#f59e0b',
        value: performanceCounts?.fair || 0,
      },
      {
        label: ap.average,
        color: '#f43f5e',
        value: performanceCounts?.average || 0,
      },
    ];
    if (!performanceCounts)
      latestEvaluationByStudent.forEach((evaluation) => {
        const raw = Number(evaluation.finalScore ?? evaluation.totalScore ?? 0);
        const score = raw <= 10 ? raw * 10 : raw;
        if (score >= 90) perfRows[0].value += 1;
        else if (score >= 80) perfRows[1].value += 1;
        else if (score >= 65) perfRows[2].value += 1;
        else if (score > 0) perfRows[3].value += 1;
      });
    const perfTotal = perfRows.reduce((sum, row) => sum + row.value, 0);
    const pass = perfRows[0].value + perfRows[1].value + perfRows[2].value;
    const ratePass = perfTotal > 0 ? Math.round((pass / perfTotal) * 100) : 0;
    const sparkline = classes.map((cls) => classStudentCounts[cls.id]?.active || 0);
    const balance = fundReport?.balance || 0;
    const sevenDays = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentLogs = auditLogs.filter((log) => {
      const time = log.timestamp ? new Date(log.timestamp).getTime() : 0;
      return Number.isFinite(time) && time >= sevenDays;
    });
    const activity = [
      {
        label: ap.newClasses,
        value: recentLogs.filter((log) => log.collection === 'classes' && log.action === 'create')
          .length,
        icon: BookOpen,
        color: '#2563eb',
        bg: 'bg-blue-50',
      },
      {
        label: ap.newStudents,
        value: recentLogs.filter((log) => log.collection === 'students' && log.action === 'create')
          .length,
        icon: Users,
        color: '#10b981',
        bg: 'bg-emerald-50',
      },
      {
        label: ap.notifications,
        value: recentLogs.filter((log) => log.collection === 'notifications').length,
        icon: Bell,
        color: '#a855f7',
        bg: 'bg-purple-50',
      },
      {
        label: ap.uploads,
        value: recentLogs.filter(
          (log) => log.collection === 'knowledge_bank' || log.collection === 'documents'
        ).length,
        icon: Database,
        color: '#fb923c',
        bg: 'bg-orange-50',
      },
    ];
    const staffClasses = selectedStaffProfile
      ? classes.filter((cls) => cls.teacherId === selectedStaffProfile.uid)
      : [];

    return {
      activeStudentsCount: activeCount,
      activeRate: rateActive,
      genderData: gender,
      performanceRows: perfRows,
      performanceTotal: perfTotal,
      passCount: pass,
      passRate: ratePass,
      classSparkline: sparkline,
      financeBalance: balance,
      recentAuditLogs: recentLogs,
      systemActivity: activity,
      selectedStaffClasses: staffClasses,
    };
  }, [
    studentRecords,
    activeStudentsTotal,
    studentsCount,
    ap,
    evaluations,
    performanceCounts,
    classes,
    classStudentCounts,
    fundReport,
    auditLogs,
    selectedStaffProfile,
  ]);

  return {
    allowedTeachers,
    blockedTeachers,
    registeredTeachers,
    registeredStaff,
    selectedStaffProfile,
    setSelectedStaffProfile,
    fundReport,
    reportLoading,
    reportFrom,
    setReportFrom,
    reportTo,
    setReportTo,
    auditLogs,
    auditUserMap,
    classes,
    studentRecords,
    evaluations,
    studentsCount,
    activeStudentsTotal,
    classStudentCounts,
    newEmail,
    setNewEmail,
    loading,
    isExporting,
    actionLoading,
    confirmDelete,
    setConfirmDelete,
    isStandardizing,
    handleLoadFundReport,
    handleExportSQL,
    handleExportExcel,
    handleStandardizeStudentIds,
    handleStandardizeTeacherIds,
    handleAddEmail,
    handleRemoveEmail,
    handleUnblockEmail,
    handleDeleteUserAccount,
    handleDeleteBlockedEmail,
    ...memoizedValues,
  };
}
