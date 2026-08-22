import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auth } from '../../lib/auth/sessionAuth';
import type { Class, CourseFeeLedger, SafeStudent, Submission, UserProfile } from '../../types';
import { readChannel } from '../api/readApi';
import { FRONTEND_LARGE_COLLECTION_LIMIT } from '../api/readLimits';
import { useInvalidationRefresh } from '../../hooks/useInvalidationRefresh';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import {
  studentGradedSubmissionsQueryOptions,
  studentLedgerQueryOptions,
  studentRosterQueryOptions,
} from './studentDirectoryQueries';
import {
  officeClassListQueryOptions,
  officeTeacherReferencesQueryOptions,
} from '../office/officeReferenceQueries';
import { FRONTEND_READ_POLL_INTERVAL_MS, readClassesData } from '../api/frontendReadApi';

const ACCOUNTING_DIRECTORY_LIMIT = 100;

export type DirectoryPaginationMode = 'client' | 'server';

export interface StudentDirectoryData {
  students: SafeStudent[];
  classes: Class[];
  teachers: { uid: string; displayName: string }[];
  parentProfiles: UserProfile[];
  parentProfilesLoaded: boolean;
  ledgers: CourseFeeLedger[];
  gradedSubmissions: Submission[];
  loading: boolean;
  loadingRemainingStudents: boolean;
  loadingDetails: boolean;
  loadingMore: boolean;
  error: string | null;
  paginationMode: DirectoryPaginationMode;
  hasMoreServer: boolean;
  loadMoreServer: () => Promise<void>;
  refresh: () => Promise<void>;
}

type UseStudentDirectoryDataArgs = {
  uid?: string;
  role: string | undefined;
  classId?: string;
};

type AccountingDirectoryPage = {
  classes?: Class[];
  students?: SafeStudent[];
  ledgers?: CourseFeeLedger[];
  teachers?: { uid: string; displayName: string }[];
  page?: {
    nextCursor?: string | null;
    hasMore?: boolean;
  };
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load students';
}

function mergeById<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of previous) map.set(item.id, item);
  for (const item of next) map.set(item.id, item);
  return Array.from(map.values());
}

function sortByName<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function useStudentDirectoryData(args: UseStudentDirectoryDataArgs): StudentDirectoryData {
  const { role, classId } = args;
  const isAccounting = role === 'accounting';
  const paginationMode: DirectoryPaginationMode = isAccounting ? 'server' : 'client';

  const uid = args.uid ?? auth.currentUser?.uid ?? '';
  const identityKey = `${uid}\u0000${role || ''}`;
  const queryIdentity = { uid, role: role || '' };
  const hasIdentity = Boolean(uid && role);
  const clientQueriesEnabled = hasIdentity && !isAccounting;
  const ledgerQueryEnabled = clientQueriesEnabled && role === 'admin';
  const submissionsQueryEnabled = clientQueriesEnabled && (role === 'admin' || role === 'teacher');
  // Office and Admin already receive these events through the app-shell
  // `OfficeInvalidationBridge`, which invalidates the very same directory keys.
  // Keeping the page-local listeners for them would refetch the roster twice
  // per write. Teacher and Accounting have no bridge, so they keep theirs.
  const usesOfficeBridge = role === 'office' || role === 'admin';

  const [progressiveRosters, setProgressiveRosters] = useState<
    Record<string, { students: SafeStudent[]; hasMore: boolean }>
  >({});
  const handleRosterPage = useCallback(
    (progress: { students: readonly SafeStudent[]; hasMore: boolean }) => {
      setProgressiveRosters((previous) => ({
        ...previous,
        [identityKey]: {
          students: [...progress.students],
          hasMore: progress.hasMore,
        },
      }));
    },
    [identityKey]
  );

  const rosterQuery = useQuery(
    studentRosterQueryOptions(queryIdentity, clientQueriesEnabled, handleRosterPage)
  );
  const ledgerQuery = useQuery(studentLedgerQueryOptions(queryIdentity, ledgerQueryEnabled));
  const submissionsQuery = useQuery(
    studentGradedSubmissionsQueryOptions(queryIdentity, submissionsQueryEnabled)
  );
  const officeClassesQuery = useQuery(
    officeClassListQueryOptions(queryIdentity, role === 'office')
  );
  const officeTeachersQuery = useQuery(
    officeTeacherReferencesQueryOptions(queryIdentity, role === 'office')
  );

  const [accountingStudents, setAccountingStudents] = useState<SafeStudent[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [teachers, setTeachers] = useState<{ uid: string; displayName: string }[]>([]);
  const [parentProfiles, setParentProfiles] = useState<UserProfile[]>([]);
  const [parentProfilesLoaded, setParentProfilesLoaded] = useState(false);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [accountingLedgers, setAccountingLedgers] = useState<CourseFeeLedger[]>([]);
  const [accountingLoading, setAccountingLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accountingError, setAccountingError] = useState<string | null>(null);
  const [serverCursor, setServerCursor] = useState<string | null>(null);
  const [hasMoreServer, setHasMoreServer] = useState(false);
  const [localStateIdentityKey, setLocalStateIdentityKey] = useState(identityKey);

  const requestIdRef = useRef(0);
  const identityRef = useRef({ uid, role });
  const serverCursorRef = useRef<string | null>(null);
  const hasMoreServerRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    serverCursorRef.current = serverCursor;
  }, [serverCursor]);

  useEffect(() => {
    hasMoreServerRef.current = hasMoreServer;
  }, [hasMoreServer]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const applyAccountingPage = useCallback((data: AccountingDirectoryPage) => {
    setAccountingStudents(sortByName(data.students || []));
    setAccountingLedgers(data.ledgers || []);
    if (data.classes) setClasses(data.classes);
    if (data.teachers) setTeachers(data.teachers);
    setServerCursor(data.page?.nextCursor || null);
    setHasMoreServer(Boolean(data.page?.hasMore));
    setParentProfiles([]);
    setParentProfilesLoaded(false);
  }, []);

  const loadAccountingFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setAccountingLoading(true);
    setAccountingError(null);
    setAccountingStudents([]);
    setAccountingLedgers([]);
    setServerCursor(null);
    setHasMoreServer(false);

    try {
      const params: Record<string, string | number | boolean> = {
        limit: ACCOUNTING_DIRECTORY_LIMIT,
      };
      if (classId) params.classId = classId;
      const data = await readChannel<AccountingDirectoryPage>('accounting-students', params);
      if (requestId !== requestIdRef.current) return;
      applyAccountingPage(data);
      setAccountingError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setAccountingError(getErrorMessage(err));
    } finally {
      if (requestId === requestIdRef.current) setAccountingLoading(false);
    }
  }, [applyAccountingPage, classId]);

  useEffect(() => {
    const previousIdentity = identityRef.current;
    identityRef.current = { uid, role };
    requestIdRef.current += 1;

    if (previousIdentity.uid !== uid || previousIdentity.role !== role) {
      setLocalStateIdentityKey(identityKey);
      setAccountingStudents([]);
      setClasses([]);
      setTeachers([]);
      setParentProfiles([]);
      setParentProfilesLoaded(false);
      setReferencesLoading(false);
      setAccountingLedgers([]);
      setServerCursor(null);
      setHasMoreServer(false);
      setAccountingError(null);
    }

    if (!uid || !role) {
      setAccountingLoading(false);
      setReferencesLoading(false);
      return;
    }

    if (isAccounting || role === 'office') {
      setReferencesLoading(false);
      if (isAccounting) {
        void loadAccountingFirstPage();
      }
      return;
    }

    const teacherId = uid;
    let cancelled = false;
    const loadReferences = async (showLoading: boolean) => {
      if (showLoading) setReferencesLoading(true);
      try {
        const [classPayload, referencePayload] = await Promise.all([
          readClassesData(),
          readChannel<{
            teachers?: { uid: string; displayName: string }[];
            parentProfiles?: UserProfile[];
          }>('student-directory-references', {
            limit: FRONTEND_LARGE_COLLECTION_LIMIT,
          }),
        ]);
        if (cancelled) return;
        setClasses(filterClassesForRoleOutsideAdminDashboard(classPayload.classes || [], role));
        setParentProfiles(referencePayload.parentProfiles || []);
        setParentProfilesLoaded(true);
        setTeachers(
          role === 'admin'
            ? referencePayload.teachers || []
            : [
                {
                  uid: teacherId,
                  displayName: auth.currentUser?.displayName || 'GV',
                },
              ]
        );
      } catch (error) {
        if (!cancelled) console.error('Error loading student directory references:', error);
      } finally {
        if (showLoading && !cancelled) setReferencesLoading(false);
      }
    };

    void loadReferences(true);
    const interval = window.setInterval(
      () => void loadReferences(false),
      FRONTEND_READ_POLL_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      requestIdRef.current += 1;
      window.clearInterval(interval);
    };
  }, [identityKey, isAccounting, loadAccountingFirstPage, role, uid]);

  const loadMoreServer = useCallback(async () => {
    if (
      !isAccounting ||
      loadingMoreRef.current ||
      !serverCursorRef.current ||
      !hasMoreServerRef.current
    ) {
      return;
    }

    setLoadingMore(true);
    setAccountingError(null);
    try {
      const params: Record<string, string | number | boolean> = {
        limit: ACCOUNTING_DIRECTORY_LIMIT,
        cursor: serverCursorRef.current,
      };
      if (classId) params.classId = classId;
      const data = await readChannel<AccountingDirectoryPage>('accounting-students', params);
      setAccountingStudents((previous) => sortByName(mergeById(previous, data.students || [])));
      setAccountingLedgers((previous) => mergeById(previous, data.ledgers || []));
      if (data.classes?.length) setClasses(data.classes);
      if (data.teachers?.length) setTeachers(data.teachers);
      setServerCursor(data.page?.nextCursor || null);
      setHasMoreServer(Boolean(data.page?.hasMore));
      setAccountingError(null);
    } catch (err) {
      setAccountingError(getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [classId, isAccounting]);

  const refetchRoster = rosterQuery.refetch;
  const refetchLedgers = ledgerQuery.refetch;
  const refetchSubmissions = submissionsQuery.refetch;

  const refreshRoster = useCallback(async () => {
    await refetchRoster();
  }, [refetchRoster]);

  const refreshLedgers = useCallback(async () => {
    await refetchLedgers();
  }, [refetchLedgers]);

  const refreshSubmissions = useCallback(async () => {
    await refetchSubmissions();
  }, [refetchSubmissions]);

  const refresh = useCallback(async () => {
    if (!hasIdentity) return;
    if (isAccounting) {
      await loadAccountingFirstPage();
      return;
    }
    await Promise.all([
      refreshRoster(),
      ledgerQueryEnabled ? refreshLedgers() : Promise.resolve(),
      submissionsQueryEnabled ? refreshSubmissions() : Promise.resolve(),
    ]);
  }, [
    hasIdentity,
    isAccounting,
    ledgerQueryEnabled,
    loadAccountingFirstPage,
    refreshLedgers,
    refreshRoster,
    refreshSubmissions,
    submissionsQueryEnabled,
  ]);

  useInvalidationRefresh({
    channelKey: 'accounting-students',
    enabled: hasIdentity && isAccounting,
    onInvalidate: loadAccountingFirstPage,
  });

  useInvalidationRefresh({
    channelKey: 'students',
    enabled: clientQueriesEnabled && !usesOfficeBridge,
    onInvalidate: refreshRoster,
  });

  useInvalidationRefresh({
    channelKey: 'finance-ledger',
    enabled: ledgerQueryEnabled && !usesOfficeBridge,
    onInvalidate: refreshLedgers,
  });

  useInvalidationRefresh({
    channelKey: 'submissions',
    enabled: submissionsQueryEnabled && !usesOfficeBridge,
    onInvalidate: refreshSubmissions,
  });

  const localStateMatchesIdentity = localStateIdentityKey === identityKey;
  const progressiveRoster = progressiveRosters[identityKey];
  const progressiveStudents = progressiveRoster?.students || [];
  const rosterStudents = rosterQuery.data ?? progressiveStudents;
  const students = useMemo(
    () =>
      isAccounting
        ? localStateMatchesIdentity
          ? accountingStudents
          : []
        : sortByName(rosterStudents),
    [accountingStudents, isAccounting, localStateMatchesIdentity, rosterStudents]
  );
  const visibleClasses = isAccounting
    ? localStateMatchesIdentity
      ? classes
      : []
    : role === 'office'
      ? officeClassesQuery.data || []
      : localStateMatchesIdentity
        ? classes
        : [];
  const visibleTeachers = isAccounting
    ? localStateMatchesIdentity
      ? teachers
      : []
    : role === 'office'
      ? (officeTeachersQuery.data || []).filter((t) => !t.blockedTeacher)
      : localStateMatchesIdentity
        ? teachers
        : [];
  const visibleParentProfiles = localStateMatchesIdentity ? parentProfiles : [];
  const visibleParentProfilesLoaded = localStateMatchesIdentity && parentProfilesLoaded;
  const ledgers = isAccounting
    ? localStateMatchesIdentity
      ? accountingLedgers
      : []
    : ledgerQuery.data || [];
  const gradedSubmissions = isAccounting ? [] : submissionsQuery.data || [];
  const clientRosterPending = clientQueriesEnabled && rosterQuery.isPending;
  const loading = isAccounting
    ? !localStateMatchesIdentity || accountingLoading
    : clientRosterPending && progressiveStudents.length === 0;
  const loadingRemainingStudents =
    !isAccounting &&
    clientRosterPending &&
    progressiveStudents.length > 0 &&
    progressiveRoster?.hasMore === true;
  const loadingReferences =
    role === 'office'
      ? officeClassesQuery.isPending || officeTeachersQuery.isPending
      : (role === 'admin' || role === 'teacher') && referencesLoading;
  const loadingDetails =
    !isAccounting &&
    clientQueriesEnabled &&
    (loadingReferences ||
      (ledgerQueryEnabled && ledgerQuery.isPending) ||
      (submissionsQueryEnabled && submissionsQuery.isPending));
  const enabledClientError = clientQueriesEnabled
    ? rosterQuery.error ||
      (ledgerQueryEnabled ? ledgerQuery.error : null) ||
      (submissionsQueryEnabled ? submissionsQuery.error : null)
    : null;
  const error = isAccounting
    ? localStateMatchesIdentity
      ? accountingError
      : null
    : enabledClientError
      ? getErrorMessage(enabledClientError)
      : null;

  return {
    students,
    classes: visibleClasses,
    teachers: visibleTeachers,
    parentProfiles: visibleParentProfiles,
    parentProfilesLoaded: visibleParentProfilesLoaded,
    ledgers,
    gradedSubmissions,
    loading,
    loadingRemainingStudents,
    loadingDetails,
    loadingMore: localStateMatchesIdentity && loadingMore,
    error,
    paginationMode,
    hasMoreServer: localStateMatchesIdentity && hasMoreServer,
    loadMoreServer,
    refresh,
  };
}
