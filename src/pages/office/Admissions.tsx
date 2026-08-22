import { type FormEvent, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Hash,
  Loader2,
  School,
  Search,
  UserPlus,
  Calendar,
  GraduationCap,
  Phone,
  User,
  Users,
  CheckCircle,
  TrendingUp,
  Clock,
  Trash2,
  Play,
  Filter,
  Sparkles,
  AlertCircle,
  ChevronRight,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import {
  createTrialAdmission,
  searchHistoricalAdmissions,
  addToWaitlist,
  deletePendingStudent,
  type AdmissionMatch,
  type RecentAdmission,
  type PendingStudent,
} from '../../lib/admissions/admissionsApi';
import {
  admissionsHistoryPageQueryOptions,
  admissionsPendingQueryOptions,
} from '../../lib/admissions/admissionsQueries';
import { officeClassListQueryOptions } from '../../lib/office/officeReferenceQueries';
import { officeQueryKeyPrefixes, officeQueryKeys } from '../../lib/office/officeQueryKeys';
import { ApiDateTextInput } from '../../components/forms/ApiDateTimeInputs';
import { apiDateTimeToDisplayDateTime, apiDateToDisplayDate } from '../../lib/core/utils';
import { useClosedCourseJoin } from '../../lib/classes/useClosedCourseJoin';

const ENROLLMENT_STATUS_META = {
  active: {
    label: 'Active',
    className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  on_leave: {
    label: 'On leave',
    className: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  dropped: {
    label: 'Dropped',
    className: 'bg-rose-100 text-rose-700 border-rose-200',
  },
  promoted: {
    label: 'Promoted',
    className: 'bg-sky-100 text-sky-700 border-sky-200',
  },
} as const;

const LIFECYCLE_STATUS_META = {
  trial: {
    label: 'Trial',
    className: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  archived: {
    label: 'Archived',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
} as const;

const REASON_LABELS: Record<string, string> = {
  name: 'Name',
  dob: 'DOB',
  contact: 'Phone',
};

function getMatchStatusMeta(match: AdmissionMatch) {
  if (match.data.studentLifecycle === 'trial') return LIFECYCLE_STATUS_META.trial;
  if (match.data.studentLifecycle === 'archived') return LIFECYCLE_STATUS_META.archived;
  if (match.data.enrollmentStatus && match.data.enrollmentStatus in ENROLLMENT_STATUS_META) {
    return ENROLLMENT_STATUS_META[match.data.enrollmentStatus];
  }
  return ENROLLMENT_STATUS_META.active;
}

function formatMatchReasons(reasons: string[]) {
  return reasons.map((reason) => REASON_LABELS[reason] || reason).join(', ');
}

function displayApiDate(value: string | undefined): string {
  if (!value) return 'N/A';
  try {
    return apiDateToDisplayDate(value);
  } catch {
    return value;
  }
}

function displayApiDateTimeDate(value: string | undefined): string {
  if (!value) return 'N/A';
  try {
    return apiDateTimeToDisplayDateTime(value, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  } catch {
    return value;
  }
}

function getLatestClassLabel(match: AdmissionMatch) {
  return match.latestClassName || match.latestClassId || 'No class on record';
}

function AdmissionMatchCard({
  match,
  variant,
  selected,
  onSelect,
}: {
  match: AdmissionMatch;
  variant: 'exact' | 'possible';
  selected?: boolean;
  onSelect?: () => void;
}) {
  const status = getMatchStatusMeta(match);
  const body = (
    <>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {variant === 'possible' ? (
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-heading">{match.data.name || match.id}</span>
            {match.data.studentId && (
              <span className="inline-flex items-center gap-1 rounded border border-border-light bg-page px-2 py-0.5 text-xs font-medium text-muted">
                <Hash className="h-3 w-3" />
                {match.data.studentId}
              </span>
            )}
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${status.className}`}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1 rounded border border-border-light bg-page px-2 py-1">
              <School className="h-3 w-3" />
              Latest class: {getLatestClassLabel(match)}
            </span>
            <span className="rounded border border-border-light bg-page px-2 py-1">
              Matched: {formatMatchReasons(match.reasons)}
            </span>
          </div>
        </div>
      </div>
      {variant === 'possible' && (
        <span className="shrink-0 rounded border border-border-light px-2 py-1 text-xs font-semibold text-muted">
          {selected ? 'Selected' : 'Select'}
        </span>
      )}
    </>
  );

  const className = [
    'mt-2 flex w-full items-start justify-between gap-3 rounded border px-3 py-3 text-left text-sm transition-colors',
    selected
      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
      : variant === 'possible'
        ? 'border-amber-200 bg-white hover:border-amber-300'
        : 'border-emerald-200 bg-white',
  ].join(' ');

  if (variant === 'possible') {
    return (
      <button type="button" onClick={onSelect} className={className}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

const getAvatarColor = (name: string) => {
  const colors = [
    'bg-red-100 text-red-700 border-red-200',
    'bg-blue-100 text-blue-700 border-blue-200',
    'bg-green-100 text-green-700 border-green-200',
    'bg-yellow-100 text-yellow-700 border-yellow-200',
    'bg-purple-100 text-purple-700 border-purple-200',
    'bg-pink-100 text-pink-700 border-pink-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200',
    'bg-rose-100 text-rose-700 border-rose-200',
    'bg-cyan-100 text-cyan-700 border-cyan-200',
    'bg-amber-100 text-amber-700 border-amber-200',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return (first + last).toUpperCase();
};

export default function Admissions() {
  const { profile } = useAuth();
  const identity = { uid: profile?.uid || '', role: profile?.role || '' };
  const enabled = Boolean(identity.uid && identity.role);
  const queryClient = useQueryClient();

  const { guard: guardClosedCourseJoin, modal: closedCourseJoinModal } = useClosedCourseJoin();
  const [formData, setFormData] = useState({
    name: '',
    dob: '',
    grade: '',
    contact: '',
    note: '',
    classId: '',
    selectedHistoricalStudentId: undefined as string | undefined,
  });
  const [exactMatches, setExactMatches] = useState<AdmissionMatch[]>([]);
  const [possibleMatches, setPossibleMatches] = useState<AdmissionMatch[]>([]);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  // Queries
  const pendingQuery = useQuery(admissionsPendingQueryOptions(identity, enabled));
  const classesQuery = useQuery(officeClassListQueryOptions(identity, enabled));
  const [historyCursors, setHistoryCursors] = useState<Array<string | null>>([null]);
  const historyQueries = useQueries({
    queries: historyCursors.map((cursor) =>
      admissionsHistoryPageQueryOptions(identity, 10, cursor, enabled)
    ),
  });

  const pendingStudents = pendingQuery.data || [];
  const classes = useMemo(
    () => (classesQuery.data || []).filter((classInfo) => classInfo.status === 'active'),
    [classesQuery.data]
  );
  const recentAdmissions = useMemo(() => {
    const list: RecentAdmission[] = [];
    for (const q of historyQueries) {
      if (q.data?.admissions) {
        list.push(...q.data.admissions);
      }
    }
    return list;
  }, [historyQueries]);

  const lastHistoryQuery = historyQueries[historyQueries.length - 1];
  const nextCursor = lastHistoryQuery?.data?.page?.nextCursor || null;
  const hasMore = lastHistoryQuery?.data?.page?.hasMore === true;
  const loadingMore = lastHistoryQuery?.isFetching === true && historyQueries.length > 1;
  const loadingRecent = historyQueries[0]?.isPending ?? true;
  const loadingPending = pendingQuery.isPending;

  // Waitlist states
  const [pendingSearch, setPendingSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'waitlist' | 'history'>('waitlist');

  // Create Trial Modal states
  const [showCreateTrialModal, setShowCreateTrialModal] = useState(false);
  const [selectedPendingStudent, setSelectedPendingStudent] = useState<PendingStudent | null>(null);
  const [creatingTrial, setCreatingTrial] = useState(false);
  const [trialFormData, setTrialFormData] = useState({
    name: '',
    dob: '',
    grade: '',
    phone: '',
    classId: '',
    note: '',
  });

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    setHistoryCursors((prev) => [...prev, nextCursor]);
  };

  const handleSearch = async () => {
    if (!formData.name || !formData.dob || !formData.contact) return;
    setSearching(true);
    try {
      const result = await searchHistoricalAdmissions({
        name: formData.name.trim(),
        dob: formData.dob,
        contact: formData.contact.trim(),
      });
      setExactMatches(result.exactMatches);
      setPossibleMatches(result.possibleMatches);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to search admissions');
    } finally {
      setSearching(false);
    }
  };

  const handleAddToWaitlistSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!formData.name.trim() || !formData.dob || !formData.contact.trim()) {
      toast.error('Student name, Date of birth and Phone are required.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const note = formData.note.trim();
      await addToWaitlist({
        name: formData.name.trim(),
        dob: formData.dob,
        contact: formData.contact.trim(),
        grade: formData.grade ? Number(formData.grade) : undefined,
        ...(note ? { note } : {}),
      });
      toast.success('Added student to waiting list successfully');
      setFormData({
        name: '',
        dob: '',
        grade: '',
        contact: '',
        note: '',
        classId: '',
        selectedHistoricalStudentId: undefined,
      });
      setExactMatches([]);
      setPossibleMatches([]);
      void queryClient.invalidateQueries({
        queryKey: officeQueryKeyPrefixes.admissionsPending,
      });
      void queryClient.invalidateQueries({
        queryKey: officeQueryKeyPrefixes.admissionsHistory,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add to waiting list');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePendingClick = async (studentId: string) => {
    if (!window.confirm('Are you sure you want to remove this student from the waiting list?')) {
      return;
    }
    const previous = queryClient.getQueryData<PendingStudent[]>(
      officeQueryKeys.admissionsPending(identity)
    );
    queryClient.setQueryData(
      officeQueryKeys.admissionsPending(identity),
      (rows: PendingStudent[] | undefined) => (rows || []).filter((row) => row.id !== studentId)
    );
    try {
      await deletePendingStudent(studentId);
      toast.success('Removed student from waiting list');
    } catch (error) {
      queryClient.setQueryData(officeQueryKeys.admissionsPending(identity), previous);
      toast.error(error instanceof Error ? error.message : 'Unable to delete student');
    } finally {
      void queryClient.invalidateQueries({
        queryKey: officeQueryKeyPrefixes.admissionsPending,
      });
      void queryClient.invalidateQueries({
        queryKey: officeQueryKeyPrefixes.admissionsHistory,
      });
    }
  };

  const openCreateTrialModal = (student: PendingStudent) => {
    setSelectedPendingStudent(student);
    setTrialFormData({
      name: student.name,
      dob: student.dob,
      grade: student.grade !== null ? String(student.grade) : '',
      phone: student.contact,
      classId: '',
      note: '',
    });
    setShowCreateTrialModal(true);
  };

  const handleCreateTrialSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPendingStudent) return;
    if (!trialFormData.classId) {
      toast.error('Please select a class for trial.');
      return;
    }
    if (!trialFormData.name.trim() || !trialFormData.dob || !trialFormData.phone.trim()) {
      toast.error('Student name, Date of birth and Phone are required.');
      return;
    }
    const targetClass = classes.find((classInfo) => classInfo.id === trialFormData.classId);
    if (!targetClass) {
      toast.error('The selected class is no longer available.');
      return;
    }

    const runCreateTrial = async (joinedAt?: string) => {
      setCreatingTrial(true);
      try {
        await createTrialAdmission({
          pendingStudentId: selectedPendingStudent.id,
          classId: trialFormData.classId,
          name: trialFormData.name.trim(),
          dob: trialFormData.dob,
          grade: trialFormData.grade ? Number(trialFormData.grade) : undefined,
          contact: trialFormData.phone.trim(),
          note: trialFormData.note || undefined,
          ...(joinedAt ? { joinedAt } : {}),
        });
        toast.success('Created trial student successfully');
        setShowCreateTrialModal(false);
        setSelectedPendingStudent(null);
        void queryClient.invalidateQueries({
          queryKey: officeQueryKeyPrefixes.admissionsPending,
        });
        void queryClient.invalidateQueries({
          queryKey: officeQueryKeyPrefixes.admissionsHistory,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to create trial student');
      } finally {
        setCreatingTrial(false);
      }
    };

    guardClosedCourseJoin(targetClass, runCreateTrial);
  };

  // Quick stats calculation
  const totalWaiting = pendingStudents.length;

  // Calculate active trials from recent admissions
  const activeTrials = recentAdmissions.filter(
    (adm) => adm.action === 'created_trial' || adm.studentLifecycle === 'trial'
  ).length;

  // Promoted count
  const promotedCount = recentAdmissions.filter(
    (adm) => adm.action === 'teacher_accepted' || adm.trialReviewStatus === 'accepted'
  ).length;
  const selectedPendingNote = selectedPendingStudent?.note?.trim();

  return (
    <div className="space-y-8 pb-20 max-w-[1400px] mx-auto animate-in fade-in duration-300">
      {/* Header section with page title & brief description */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border-default pb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-heading tracking-tight flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-blue-500 animate-pulse" />
            Admissions Dashboard
          </h1>
          <p className="text-muted mt-1 text-sm md:text-base">
            Seamlessly manage student registration, waitlists, and trial memberships.
          </p>
        </div>
      </div>

      {/* Analytics / KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Total Waiting */}
        <div className="bg-surface border border-border-default/60 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-2 -translate-y-2 h-16 w-16 bg-blue-500/5 rounded-full group-hover:scale-125 transition-transform duration-300" />
          <div className="p-3.5 rounded-lg bg-blue-500/10 text-blue-600 border border-blue-500/10">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <span className="block text-xs font-semibold text-muted uppercase tracking-wider">
              Waiting List
            </span>
            <span className="text-2xl font-bold text-heading mt-0.5 block">{totalWaiting}</span>
            <span className="text-[10px] text-muted block mt-0.5">Students awaiting placement</span>
          </div>
        </div>

        {/* Card 2: Active Trials */}
        <div className="bg-surface border border-border-default/60 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-2 -translate-y-2 h-16 w-16 bg-amber-500/5 rounded-full group-hover:scale-125 transition-transform duration-300" />
          <div className="p-3.5 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/10">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <span className="block text-xs font-semibold text-muted uppercase tracking-wider">
              Active Trials
            </span>
            <span className="text-2xl font-bold text-heading mt-0.5 block">{activeTrials}</span>
            <span className="text-[10px] text-muted block mt-0.5">Ongoing evaluation sessions</span>
          </div>
        </div>

        {/* Card 3: Promoted Trials */}
        <div className="bg-surface border border-border-default/60 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-2 -translate-y-2 h-16 w-16 bg-emerald-500/5 rounded-full group-hover:scale-125 transition-transform duration-300" />
          <div className="p-3.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/10">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <span className="block text-xs font-semibold text-muted uppercase tracking-wider">
              Promoted Recently
            </span>
            <span className="text-2xl font-bold text-heading mt-0.5 block">{promotedCount}</span>
            <span className="text-[10px] text-muted block mt-0.5">
              Trial students enrolled as active
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid Layout - Split view (Form left, Lists right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Register Student to Waitlist (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <form
            onSubmit={handleAddToWaitlistSubmit}
            className="bg-surface border border-border-default/80 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-4"
          >
            <div className="pb-3 border-b border-border-default/60 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-500" />
              <h2 className="text-base font-bold text-heading">Add New Admission</h2>
            </div>

            {/* Student Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="studentName"
                className="text-xs font-semibold text-heading flex items-center gap-1.5"
              >
                <User className="h-3.5 w-3.5 text-muted" />
                Student Name *
              </label>
              <input
                id="studentName"
                required
                type="text"
                placeholder="e.g. John Doe"
                className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={formData.name}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    name: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>

            {/* DOB */}
            <div className="space-y-1.5">
              <label
                htmlFor="dob"
                className="text-xs font-semibold text-heading flex items-center gap-1.5"
              >
                <Calendar className="h-3.5 w-3.5 text-muted" />
                Date of Birth *
              </label>
              <ApiDateTextInput
                id="dob"
                label="Date of Birth"
                hideLabel
                required
                inputClassName="w-full rounded-lg border-border-default px-3 py-2 bg-page text-sm text-heading focus:ring-blue-500/20 focus:border-blue-500"
                value={formData.dob}
                onChange={(dob) => setFormData((previous) => ({ ...previous, dob }))}
              />
            </div>

            {/* Grade */}
            <div className="space-y-1.5">
              <label
                htmlFor="grade"
                className="text-xs font-semibold text-heading flex items-center gap-1.5"
              >
                <GraduationCap className="h-3.5 w-3.5 text-muted" />
                Grade Level
              </label>
              <input
                id="grade"
                type="number"
                min={1}
                max={12}
                placeholder="e.g. 6"
                className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={formData.grade}
                onChange={(event) =>
                  setFormData((previous) => ({ ...previous, grade: event.target.value }))
                }
              />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <label
                htmlFor="phone"
                className="text-xs font-semibold text-heading flex items-center gap-1.5"
              >
                <Phone className="h-3.5 w-3.5 text-muted" />
                Contact Phone *
              </label>
              <input
                id="phone"
                required
                type="text"
                placeholder="e.g. 0901234567"
                className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={formData.contact}
                onChange={(event) =>
                  setFormData((previous) => ({ ...previous, contact: event.target.value }))
                }
              />
            </div>

            {/* Placement Note */}
            <div className="space-y-1.5">
              <label
                htmlFor="waitlistNote"
                className="text-xs font-semibold text-heading flex items-center gap-1.5"
              >
                <Info className="h-3.5 w-3.5 text-muted" />
                Placement Note
              </label>
              <textarea
                id="waitlistNote"
                rows={3}
                maxLength={1000}
                placeholder="Preferred class, schedule, placement notes..."
                className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                value={formData.note}
                onChange={(event) =>
                  setFormData((previous) => ({ ...previous, note: event.target.value }))
                }
              />
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors font-semibold text-sm shadow-sm"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Add to Waitlist
              </button>

              <button
                type="button"
                onClick={handleSearch}
                disabled={searching || !formData.name || !formData.dob || !formData.contact}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border-default px-4 py-2.5 hover:bg-surface-hover transition-colors font-medium text-heading text-sm disabled:opacity-40"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search History
              </button>
            </div>

            {/* Matching Results (Inline) */}
            {exactMatches.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 mt-3 animate-in slide-in-from-top-2 duration-200">
                <p className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                  Exact Historical Matches
                </p>
                {exactMatches.map((match) => (
                  <AdmissionMatchCard key={match.id} match={match} variant="exact" />
                ))}
              </div>
            )}

            {possibleMatches.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mt-3 animate-in slide-in-from-top-2 duration-200">
                <p className="text-xs font-bold text-amber-800 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Possible Matches Found
                </p>
                {possibleMatches.map((match) => (
                  <AdmissionMatchCard
                    key={match.id}
                    match={match}
                    variant="possible"
                    selected={formData.selectedHistoricalStudentId === match.id}
                    onSelect={() =>
                      setFormData((previous) => ({
                        ...previous,
                        selectedHistoricalStudentId: match.id,
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Right Column: Tabbed controls and Data table lists (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-surface border border-border-default/80 rounded-xl shadow-sm overflow-hidden">
            {/* Pill Tab Controls Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border-b border-border-default/60 gap-4 bg-page/30">
              <div className="flex bg-page p-1 rounded-lg border border-border-default max-w-max">
                <button
                  type="button"
                  onClick={() => setActiveTab('waitlist')}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeTab === 'waitlist'
                      ? 'bg-surface text-blue-600 shadow-sm'
                      : 'text-muted hover:text-heading'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  Waiting List
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      activeTab === 'waitlist' ? 'bg-blue-100 text-blue-700' : 'bg-page text-muted'
                    }`}
                  >
                    {totalWaiting}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeTab === 'history'
                      ? 'bg-surface text-blue-600 shadow-sm'
                      : 'text-muted hover:text-heading'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Admissions Timeline
                </button>
              </div>

              {/* Waiting list search bar */}
              {activeTab === 'waitlist' && pendingStudents.length > 0 && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Quick search waiting..."
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    className="w-full sm:w-64 pl-8 pr-3 py-1.5 rounded-lg border border-border-default bg-page text-xs text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
                </div>
              )}
            </div>

            {/* Content panel */}
            <div className="p-6">
              {/* TAB 1: Waiting List */}
              {activeTab === 'waitlist' && (
                <div className="space-y-4">
                  {loadingPending ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-3">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <span className="text-sm text-muted">Retrieving student records...</span>
                    </div>
                  ) : pendingStudents.length === 0 ? (
                    /* Beautiful Empty State */
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-border-default rounded-xl bg-page/10 max-w-lg mx-auto">
                      <div className="p-4 rounded-full bg-blue-50 text-blue-500 border border-blue-100">
                        <Sparkles className="h-8 w-8" />
                      </div>
                      <h3 className="text-base font-bold text-heading mt-4">
                        Waiting List is Empty
                      </h3>
                      <p className="text-xs text-muted mt-2 max-w-sm">
                        There are no students awaiting placement right now. Use the form on the left
                        to add prospective students to the list.
                      </p>
                    </div>
                  ) : (
                    /* Student list display */
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                      {pendingStudents
                        .filter((student) => {
                          const search = pendingSearch.toLowerCase().trim();
                          if (!search) return true;
                          return (
                            (student.name || '').toLowerCase().includes(search) ||
                            (student.contact || '').includes(search) ||
                            (student.studentId || '').toLowerCase().includes(search) ||
                            (student.note || '').toLowerCase().includes(search)
                          );
                        })
                        .map((student) => {
                          const note = student.note?.trim();
                          const initials = getInitials(student.name);
                          const avatarColor = getAvatarColor(student.name);
                          return (
                            <div
                              key={student.id}
                              className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border-default p-4 hover:border-blue-300 hover:bg-blue-50/5 hover:shadow-sm transition-all duration-200 bg-page/20"
                            >
                              {/* Avatar and Student Core details */}
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div
                                  className={`h-11 w-11 rounded-full shrink-0 flex items-center justify-center font-bold text-sm border shadow-sm ${avatarColor}`}
                                >
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-heading text-sm group-hover:text-blue-600 transition-colors">
                                      {student.name}
                                    </span>
                                    <span className="inline-flex items-center gap-0.5 rounded border border-border-light bg-surface px-1.5 py-0.5 text-[9px] font-semibold text-muted shadow-sm">
                                      <Hash className="h-2.5 w-2.5" />
                                      {student.studentId}
                                    </span>
                                    <span className="inline-flex items-center rounded border border-blue-100 bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[9px] font-bold tracking-wide">
                                      Waiting
                                    </span>
                                  </div>

                                  {/* Info badges list */}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted">
                                    <span className="flex items-center gap-1">
                                      <Calendar className="h-3.5 w-3.5 text-muted/80" />
                                      {displayApiDate(student.dob)}
                                    </span>
                                    {student.grade !== null && (
                                      <span className="flex items-center gap-1">
                                        <GraduationCap className="h-3.5 w-3.5 text-muted/80" />
                                        Grade {student.grade}
                                      </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                      <Phone className="h-3.5 w-3.5 text-muted/80" />
                                      {student.contact}
                                    </span>
                                  </div>
                                  {note && (
                                    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50/60 px-2.5 py-2 text-xs text-amber-800">
                                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                                      <span className="min-w-0 whitespace-pre-wrap break-words">
                                        {note}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Action buttons panel */}
                              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openCreateTrialModal(student)}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
                                >
                                  <Play className="h-3 w-3 fill-current" />
                                  Create Trial
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePendingClick(student.id)}
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-red-100 text-red-500 bg-red-50/20 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors"
                                  title="Remove from waitlist"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Admissions History Timeline */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  {loadingRecent ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-3">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <span className="text-sm text-muted">Retrieving history logs...</span>
                    </div>
                  ) : recentAdmissions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-border-default rounded-xl bg-page/10 max-w-lg mx-auto">
                      <div className="p-4 rounded-full bg-slate-50 text-slate-400 border border-slate-100">
                        <Clock className="h-8 w-8" />
                      </div>
                      <h3 className="text-base font-bold text-heading mt-4">Timeline is Empty</h3>
                      <p className="text-xs text-muted mt-2 max-w-sm">
                        No admissions events have been recorded yet in the history.
                      </p>
                    </div>
                  ) : (
                    /* Timeline tracker rendering */
                    <div className="relative border-l border-border-default ml-3 pl-6 space-y-6 max-h-[500px] overflow-y-auto pr-1 pb-2">
                      {recentAdmissions.map((admission) => {
                        // Action styling mapper
                        let iconBg = 'bg-blue-100 text-blue-600 border-blue-200';
                        let actionLabel = 'Created trial';
                        let actionIcon = <UserPlus className="h-3.5 w-3.5" />;

                        if (admission.action === 'added_to_waitlist') {
                          iconBg = 'bg-indigo-100 text-indigo-600 border-indigo-200';
                          actionLabel = 'Added to waitlist';
                          actionIcon = <Users className="h-3.5 w-3.5" />;
                        } else if (admission.action === 'deleted_from_waitlist') {
                          iconBg = 'bg-rose-100 text-rose-600 border-rose-200';
                          actionLabel = 'Removed from waitlist';
                          actionIcon = <Trash2 className="h-3.5 w-3.5" />;
                        } else if (admission.action === 'reactivated_trial') {
                          iconBg = 'bg-amber-100 text-amber-600 border-amber-200';
                          actionLabel = 'Reactivated trial';
                          actionIcon = <Sparkles className="h-3.5 w-3.5" />;
                        } else if (admission.action === 'teacher_accepted') {
                          iconBg = 'bg-emerald-100 text-emerald-600 border-emerald-200';
                          actionLabel = 'Enrolled successfully';
                          actionIcon = <CheckCircle className="h-3.5 w-3.5" />;
                        } else if (admission.action === 'teacher_rejected') {
                          iconBg = 'bg-red-100 text-red-600 border-red-200';
                          actionLabel = 'Trial rejected';
                          actionIcon = <AlertCircle className="h-3.5 w-3.5" />;
                        }

                        return (
                          <div key={admission.id} className="relative group">
                            {/* Bullet dot indicator on timeline line */}
                            <span className="absolute -left-[37px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-surface text-center shadow-sm">
                              <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping absolute opacity-30 group-hover:block hidden" />
                              <span className="h-2 w-2 rounded-full bg-blue-500" />
                            </span>

                            <div className="bg-page/20 border border-border-default/50 rounded-xl p-4 shadow-sm hover:border-blue-200 hover:bg-blue-50/5 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-heading text-sm">
                                    {admission.studentName || admission.studentId || 'Student'}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase ${iconBg}`}
                                  >
                                    {actionIcon}
                                    {actionLabel}
                                  </span>
                                </div>
                                <p className="text-muted text-xs mt-1.5 flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 bg-surface border border-border-light px-1.5 py-0.5 rounded text-[10px] font-medium text-heading">
                                    <School className="h-3 w-3" />
                                    {admission.className || admission.classId || 'No class'}
                                  </span>
                                  {admission.trialSessionCount !== undefined && (
                                    <span className="inline-flex items-center gap-1 bg-surface border border-border-light px-1.5 py-0.5 rounded text-[10px] font-medium text-heading">
                                      <Sparkles className="h-3 w-3 text-amber-500" />
                                      Session: {admission.trialSessionCount}/
                                      {admission.trialRequiredSessions || 2}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="text-[10px] text-muted whitespace-nowrap self-end sm:self-start bg-surface border border-border-light px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                                <Clock className="h-3 w-3 text-muted/80" />
                                {displayApiDateTimeDate((admission as any).timestamp)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {hasMore && (
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="mt-2 w-full rounded-lg border border-border-default py-2 text-center text-xs font-semibold hover:bg-surface-hover hover:border-blue-300 hover:text-blue-500 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 bg-page/30"
                    >
                      {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Load More History Logs
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Trial Dialog/Modal with Glassmorphism Backdrop */}
      {showCreateTrialModal && selectedPendingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl border border-border-default/80 bg-surface shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-250">
            {/* Pop-up header */}
            <div className="flex items-center gap-2 border-b border-border-default/80 pb-3">
              <Sparkles className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-bold text-heading">Create Trial Admission</h3>
            </div>

            <form onSubmit={handleCreateTrialSubmit} className="mt-4 space-y-4">
              {/* Alert notice box */}
              <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex gap-2.5 items-start text-xs text-blue-800 leading-normal animate-pulse">
                <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
                <div>
                  Review student credentials and associate them with an active class. All fields are
                  pre-filled from their waitlist record.
                </div>
              </div>

              {selectedPendingNote && (
                <div
                  aria-label="Waitlist placement note"
                  className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800"
                >
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <p className="font-bold uppercase tracking-wide text-[10px] text-amber-700">
                        Waitlist Note
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{selectedPendingNote}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Grid forms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Student Name */}
                <div className="space-y-1">
                  <label
                    htmlFor="modalName"
                    className="text-xs font-semibold text-heading flex items-center gap-1"
                  >
                    <User className="h-3 w-3 text-muted" />
                    Student name *
                  </label>
                  <input
                    id="modalName"
                    required
                    type="text"
                    value={trialFormData.name}
                    onChange={(e) =>
                      setTrialFormData((prev) => ({ ...prev, name: e.target.value.toUpperCase() }))
                    }
                    className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                {/* DOB */}
                <div className="space-y-1">
                  <label
                    htmlFor="modalDob"
                    className="text-xs font-semibold text-heading flex items-center gap-1"
                  >
                    <Calendar className="h-3 w-3 text-muted" />
                    Date of birth *
                  </label>
                  <ApiDateTextInput
                    id="modalDob"
                    label="Date of birth"
                    hideLabel
                    required
                    value={trialFormData.dob}
                    onChange={(dob) => setTrialFormData((prev) => ({ ...prev, dob }))}
                    inputClassName="w-full rounded-lg border-border-default px-3 py-2 bg-page text-sm text-heading focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                {/* Grade */}
                <div className="space-y-1">
                  <label
                    htmlFor="modalGrade"
                    className="text-xs font-semibold text-heading flex items-center gap-1"
                  >
                    <GraduationCap className="h-3 w-3 text-muted" />
                    Grade Level
                  </label>
                  <input
                    id="modalGrade"
                    type="number"
                    min={1}
                    max={12}
                    value={trialFormData.grade}
                    onChange={(e) =>
                      setTrialFormData((prev) => ({ ...prev, grade: e.target.value }))
                    }
                    className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <label
                    htmlFor="modalPhone"
                    className="text-xs font-semibold text-heading flex items-center gap-1"
                  >
                    <Phone className="h-3 w-3 text-muted" />
                    Contact Phone *
                  </label>
                  <input
                    id="modalPhone"
                    required
                    type="text"
                    value={trialFormData.phone}
                    onChange={(e) =>
                      setTrialFormData((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              {/* Class Dropdown */}
              <div className="space-y-1">
                <label
                  htmlFor="modalClass"
                  className="text-xs font-semibold text-heading flex items-center gap-1"
                >
                  <School className="h-3 w-3 text-muted" />
                  Choose class for trial *
                </label>
                <select
                  id="modalClass"
                  required
                  value={trialFormData.classId}
                  onChange={(e) =>
                    setTrialFormData((prev) => ({ ...prev, classId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                >
                  <option value="">Select active class...</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Note */}
              <div className="space-y-1">
                <label
                  htmlFor="modalNote"
                  className="text-xs font-semibold text-heading flex items-center gap-1"
                >
                  Note (Optional)
                </label>
                <textarea
                  id="modalNote"
                  value={trialFormData.note}
                  onChange={(e) => setTrialFormData((prev) => ({ ...prev, note: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-border-default px-3 py-2 bg-page text-sm text-heading placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                  placeholder="Enter admission details, trial remarks, sibling links..."
                />
              </div>

              {/* Dialog Footers */}
              <div className="flex justify-end gap-3 pt-3 border-t border-border-default/80 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateTrialModal(false);
                    setSelectedPendingStudent(null);
                  }}
                  className="rounded-lg border border-border-default px-4 py-2 hover:bg-surface-hover text-xs font-bold transition-colors text-heading active:scale-95"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creatingTrial}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  {creatingTrial && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Trial Placement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {closedCourseJoinModal}
    </div>
  );
}
