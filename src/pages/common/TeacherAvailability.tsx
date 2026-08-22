import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, CheckCircle2, Loader2, Settings, Send, Users, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/api/apiClient';
import { cn } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { formatTemplate } from '../../lib/i18n/formatTemplate';
import { FIXED_AVAILABILITY_SLOTS } from '../../../shared/teacherAvailability';
import {
  getTeacherBusyClassNotesForSlots,
  type TeacherBusyClassNote,
} from '../../lib/availability/teacherBusyNotes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  teacherAvailabilityPendingQueryOptions,
  teacherAvailabilityProfilesQueryOptions,
} from '../../lib/office/officeTeacherAvailabilityQueries';
import { officeClassListQueryOptions } from '../../lib/office/officeReferenceQueries';
import { officeQueryKeys } from '../../lib/office/officeQueryKeys';
import type {
  AvailabilityDayKey,
  AvailabilityPairKey,
  Class,
  TeacherAvailabilityChangeRequest,
  TeacherAvailabilityProfile,
  TeacherAvailabilitySelection,
  TeacherAvailabilitySlot,
} from '../../types';

type WeekdayKey = AvailabilityDayKey;
type TeacherAvailabilityDaySelection = TeacherAvailabilitySelection & {
  dayKey: AvailabilityDayKey;
};

type TeacherAvailabilityPageText = ReturnType<typeof useLanguage>['t']['teacherAvailabilityPage'];
type AvailabilityCellStatus = 'available' | 'busy' | 'teaching' | 'undeclared';

const WEEK_DAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const EMPTY_PROFILES: TeacherAvailabilityProfile[] = [];
const EMPTY_REQUESTS: TeacherAvailabilityChangeRequest[] = [];
const EMPTY_CLASSES: Class[] = [];

const PAIRS: Array<{ key: AvailabilityPairKey; dayKeys: WeekdayKey[] }> = [
  { key: 'tue_thu', dayKeys: ['tue', 'thu'] },
  { key: 'wed_fri', dayKeys: ['wed', 'fri'] },
  { key: 'sat_sun', dayKeys: ['sat', 'sun'] },
  { key: 'sun_mon', dayKeys: ['sun', 'mon'] },
];

function buildWeekDays(labels: TeacherAvailabilityPageText['weekdays']) {
  return WEEK_DAY_KEYS.map((key) => ({ key, label: labels[key] }));
}

function formatBusyClassNote(notes: TeacherBusyClassNote[], template: string) {
  if (notes.length === 0) return '';
  const detail = notes.map((note) => `${note.className} - ${note.timeRange}`).join('; ');
  return formatTemplate(template, { detail });
}

function formatTeachingCellNote(notes: TeacherBusyClassNote[], template: string) {
  if (notes.length === 0) return '';
  const detail = notes.map((note) => note.className).join('; ');
  return formatTemplate(template, { detail });
}

function formatTeachingCellTitle(notes: TeacherBusyClassNote[]) {
  return notes.map((note) => `${note.className} - ${note.timeRange}`).join('; ');
}

function teacherDayCellKey(teacherId: string, dayKey: WeekdayKey, slotId: string) {
  return `${teacherId}:${dayKey}:${slotId}`;
}

function daySelectionKey(selection: TeacherAvailabilityDaySelection) {
  return `${selection.dayKey}:${selection.slotId}`;
}

function sortSlots(slots: TeacherAvailabilitySlot[]) {
  return [...slots].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function formatSlotTime(slot: TeacherAvailabilitySlot) {
  return `${slot.startTime} - ${slot.endTime}`;
}

function getDayKeysForPairs(pairKeys: AvailabilityPairKey[]) {
  const dayKeys = new Set<WeekdayKey>();
  for (const pair of PAIRS) {
    if (!pairKeys.includes(pair.key)) continue;
    pair.dayKeys.forEach((dayKey) => dayKeys.add(dayKey));
  }
  return WEEK_DAY_KEYS.filter((dayKey) => dayKeys.has(dayKey));
}

function isDayAllowed(slot: TeacherAvailabilitySlot, dayKey: WeekdayKey) {
  return getDayKeysForPairs(slot.allowedPairs).includes(dayKey);
}

function expandSelectionsToDays(
  selections: TeacherAvailabilitySelection[]
): TeacherAvailabilityDaySelection[] {
  return selections.flatMap((selection) => {
    if (selection.dayKey) {
      return [{ dayKey: selection.dayKey, slotId: selection.slotId }];
    }
    const pair = PAIRS.find((item) => item.key === selection.pairKey);
    if (!pair) return [];
    return pair.dayKeys.map((dayKey) => ({ dayKey, slotId: selection.slotId }));
  });
}

function buildDaySelections(
  daySelections: TeacherAvailabilityDaySelection[]
): TeacherAvailabilitySelection[] {
  const byKey = new Map<string, TeacherAvailabilitySelection>();

  for (const daySelection of daySelections) {
    const normalized = { dayKey: daySelection.dayKey, slotId: daySelection.slotId };
    byKey.set(daySelectionKey(normalized), normalized);
  }

  return [...byKey.values()].sort((a, b) => {
    const dayDiff =
      WEEK_DAY_KEYS.findIndex((dayKey) => dayKey === a.dayKey) -
      WEEK_DAY_KEYS.findIndex((dayKey) => dayKey === b.dayKey);
    if (dayDiff !== 0) return dayDiff;
    return a.slotId.localeCompare(b.slotId);
  });
}

const availabilityStatusStyles: Record<
  AvailabilityCellStatus,
  { cell: string; badge: string; dot: string }
> = {
  available: {
    cell: 'bg-green-50',
    badge: 'border-green-200 bg-green-100 text-green-800',
    dot: 'bg-green-500',
  },
  busy: {
    cell: 'bg-rose-50',
    badge: 'border-rose-200 bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
  },
  teaching: {
    cell: 'bg-amber-50',
    badge: 'border-amber-200 bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  undeclared: {
    cell: 'bg-slate-50',
    badge: 'border-slate-200 bg-slate-100 text-slate-500',
    dot: 'bg-slate-300',
  },
};

function AvailabilityLegend({ text }: { text: TeacherAvailabilityPageText['grid'] }) {
  const items: Array<{ status: AvailabilityCellStatus; label: string }> = [
    { status: 'available', label: text.legend.available },
    { status: 'busy', label: text.legend.busy },
    { status: 'teaching', label: text.legend.teaching },
    { status: 'undeclared', label: text.legend.undeclared },
  ];

  return (
    <div className="border-b border-slate-100 px-4 py-2">
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        {items.map((item) => (
          <span
            key={item.status}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
              availabilityStatusStyles[item.status].badge
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full', availabilityStatusStyles[item.status].dot)}
              aria-hidden="true"
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeacherProfileButton({
  teacherProfile,
  active,
  busyNoteText,
  onSelect,
}: {
  teacherProfile: TeacherAvailabilityProfile;
  active: boolean;
  busyNoteText?: string;
  onSelect: () => void;
}) {
  const teacherName = teacherProfile.teacherName || teacherProfile.teacherId;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-left text-sm font-semibold transition-colors',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'
      )}
    >
      <span className="block">{teacherName}</span>
      {busyNoteText && (
        <span className="mt-1 block text-[11px] font-medium leading-snug text-amber-700">
          {busyNoteText}
        </span>
      )}
    </button>
  );
}

function AvailabilityGrid({
  title,
  slots,
  selections,
  text,
  weekDays,
  hasDeclaration = true,
  getBusyNotes,
  interactive = false,
  onToggle,
}: {
  title?: string;
  slots: TeacherAvailabilitySlot[];
  selections: TeacherAvailabilitySelection[];
  text: TeacherAvailabilityPageText['grid'];
  weekDays: Array<{ key: WeekdayKey; label: string }>;
  hasDeclaration?: boolean;
  getBusyNotes?: (slotId: string, dayKey: WeekdayKey) => TeacherBusyClassNote[];
  interactive?: boolean;
  onToggle?: (slotId: string, dayKey: WeekdayKey) => void;
}) {
  const selectedDayKeys = new Set(expandSelectionsToDays(selections).map(daySelectionKey));

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {title && (
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
          {title}
        </div>
      )}
      <AvailabilityLegend text={text} />
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
              <th className="w-28 border-b border-r border-slate-200 px-3 py-3 text-left">
                {text.timeSlot}
              </th>
              {weekDays.map((day) => (
                <th
                  key={day.key}
                  className="border-b border-r border-slate-200 px-3 py-3 text-center last:border-r-0"
                >
                  {day.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 ? (
              <tr>
                <td colSpan={weekDays.length + 1} className="px-4 py-8 text-center text-slate-500">
                  {text.noSlots}
                </td>
              </tr>
            ) : (
              slots.map((slot, rowIndex) => (
                <tr key={slot.id} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                  <th className="border-b border-r border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-700">
                    <div>{slot.label}</div>
                    <div className="mt-0.5 text-[11px] font-medium text-slate-500">
                      {formatSlotTime(slot)}
                    </div>
                  </th>
                  {weekDays.map((day) => {
                    const allowed = isDayAllowed(slot, day.key);
                    const active = selectedDayKeys.has(
                      daySelectionKey({ dayKey: day.key, slotId: slot.id })
                    );
                    const busyNotes = allowed ? getBusyNotes?.(slot.id, day.key) || [] : [];
                    const status: AvailabilityCellStatus = !allowed
                      ? 'undeclared'
                      : busyNotes.length > 0
                        ? 'teaching'
                        : active
                          ? 'available'
                          : hasDeclaration || interactive
                            ? 'busy'
                            : 'undeclared';
                    const statusText =
                      status === 'teaching'
                        ? formatTeachingCellNote(busyNotes, text.teachingMarker)
                        : status === 'available'
                          ? text.selectedMarker
                          : status === 'busy'
                            ? text.busyMarker
                            : text.undeclaredMarker;
                    const statusTitle =
                      status === 'teaching' ? formatTeachingCellTitle(busyNotes) : statusText;
                    const label = formatTemplate(text.cellLabel, {
                      day: day.label,
                      slot: slot.label,
                    });
                    const statusLabel = formatTemplate(text.cellStatusLabel, {
                      day: day.label,
                      slot: slot.label,
                      status: statusText,
                    });
                    const cellContent = (
                      <span
                        className={cn(
                          'inline-flex max-w-full items-center justify-center rounded-md border px-2 py-1 text-center text-[11px] font-bold leading-tight',
                          availabilityStatusStyles[status].badge
                        )}
                      >
                        {statusText}
                      </span>
                    );

                    return (
                      <td
                        key={`${slot.id}:${day.key}`}
                        className="min-h-12 border-b border-r border-slate-200 p-0 last:border-r-0"
                      >
                        {!allowed ? (
                          <div
                            className={cn(
                              'flex min-h-12 items-center justify-center px-1.5 py-1',
                              availabilityStatusStyles.undeclared.cell
                            )}
                            aria-label={statusLabel}
                            title={statusTitle}
                          >
                            {cellContent}
                          </div>
                        ) : !interactive ? (
                          <div
                            aria-label={statusLabel}
                            title={statusTitle}
                            className={cn(
                              'flex min-h-12 items-center justify-center px-1.5 py-1',
                              availabilityStatusStyles[status].cell
                            )}
                          >
                            {cellContent}
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-label={statusLabel || label}
                            title={statusTitle}
                            onClick={() => onToggle?.(slot.id, day.key)}
                            className={cn(
                              'flex min-h-12 w-full items-center justify-center px-1.5 py-1 transition-colors',
                              availabilityStatusStyles[status].cell,
                              active
                                ? 'shadow-[inset_0_0_0_1px_rgba(21,128,61,0.35)]'
                                : 'hover:bg-rose-100'
                            )}
                          >
                            {cellContent}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TeacherAvailability() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const pageText = t.teacherAvailabilityPage;
  const isReviewer = profile?.role === 'admin' || profile?.role === 'office';
  const identity = useMemo(
    () => ({ uid: profile?.uid || '', role: profile?.role || '' }),
    [profile?.uid, profile?.role]
  );
  const availabilityQueryEnabled = Boolean(identity.uid);

  const profilesQuery = useQuery(
    teacherAvailabilityProfilesQueryOptions(identity, availabilityQueryEnabled)
  );
  const requestsQuery = useQuery(
    teacherAvailabilityPendingQueryOptions(identity, availabilityQueryEnabled)
  );
  const classesQuery = useQuery(officeClassListQueryOptions(identity, Boolean(identity.uid)));

  // Keep fallback references stable while the queries are loading. The teacher
  // selection effect depends on `profiles`; allocating a new [] every render
  // creates a render loop before the first HTTP response can settle.
  const profiles = profilesQuery.data || EMPTY_PROFILES;
  const requests = requestsQuery.data || EMPTY_REQUESTS;
  const classes = classesQuery.data || EMPTY_CLASSES;

  const [selectedDays, setSelectedDays] = useState<TeacherAvailabilityDaySelection[]>([]);
  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewingAction, setReviewingAction] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const fixedSlots = useMemo(
    () => sortSlots(FIXED_AVAILABILITY_SLOTS as TeacherAvailabilitySlot[]),
    []
  );
  const weekDays = useMemo(() => buildWeekDays(pageText.weekdays), [pageText.weekdays]);
  const reviewerProfiles = useMemo(
    () =>
      [...profiles].sort((a, b) =>
        String(a.teacherName || '').localeCompare(String(b.teacherName || ''))
      ),
    [profiles]
  );
  const reviewerTeacherIds = useMemo(
    () =>
      [
        ...new Set([
          ...reviewerProfiles.map((teacherProfile) => teacherProfile.teacherId),
          ...requests.map((request) => request.teacherId),
        ]),
      ].filter(Boolean),
    [requests, reviewerProfiles]
  );
  const profilesByDay = useMemo(
    () =>
      weekDays.map((day) => ({
        ...day,
        profiles: reviewerProfiles.filter((teacherProfile) =>
          expandSelectionsToDays(teacherProfile.selections || []).some(
            (selection) => selection.dayKey === day.key
          )
        ),
      })),
    [reviewerProfiles, weekDays]
  );

  const busyNotesByTeacherDay = useMemo(() => {
    const notesByKey = new Map<string, TeacherBusyClassNote[]>();

    for (const teacherProfile of reviewerProfiles) {
      for (const dayKey of WEEK_DAY_KEYS) {
        const notes = getTeacherBusyClassNotesForSlots({
          classes,
          slots: fixedSlots.filter((slot) => isDayAllowed(slot, dayKey)),
          teacherId: teacherProfile.teacherId,
          dayKey,
        });

        if (notes.length > 0) {
          notesByKey.set(`${teacherProfile.teacherId}:${dayKey}`, notes);
        }
      }
    }

    return notesByKey;
  }, [classes, fixedSlots, reviewerProfiles]);
  const busyNotesByTeacherCell = useMemo(() => {
    const notesByKey = new Map<string, TeacherBusyClassNote[]>();

    for (const teacherId of reviewerTeacherIds) {
      for (const dayKey of WEEK_DAY_KEYS) {
        for (const slot of fixedSlots) {
          if (!isDayAllowed(slot, dayKey)) continue;

          const notes = getTeacherBusyClassNotesForSlots({
            classes,
            slots: [slot],
            teacherId,
            dayKey,
          });

          if (notes.length > 0) {
            notesByKey.set(teacherDayCellKey(teacherId, dayKey, slot.id), notes);
          }
        }
      }
    }

    return notesByKey;
  }, [classes, fixedSlots, reviewerTeacherIds]);
  const selectedProfile = useMemo(
    () =>
      reviewerProfiles.find((teacherProfile) => teacherProfile.id === selectedProfileId) || null,
    [reviewerProfiles, selectedProfileId]
  );

  useEffect(() => {
    if (isReviewer) return;
    setSelectedDays(expandSelectionsToDays(profiles[0]?.selections || []));
  }, [isReviewer, profiles]);

  useEffect(() => {
    if (!isReviewer) {
      setSelectedProfileId(null);
      return;
    }
    setSelectedProfileId((current) =>
      current && reviewerProfiles.some((teacherProfile) => teacherProfile.id === current)
        ? current
        : reviewerProfiles[0]?.id || null
    );
  }, [isReviewer, reviewerProfiles]);

  const ownProfile = !isReviewer ? profiles[0] : null;
  const pendingRequest = !isReviewer ? requests[0] : null;
  const activeSlots = fixedSlots;
  const displaySlots = fixedSlots;
  const submitLabel = submitting
    ? ownProfile
      ? pageText.actions.submitting
      : pageText.actions.saving
    : ownProfile
      ? pageText.actions.submitForReview
      : pageText.actions.saveAvailability;

  const toggleSelection = (slotId: string, dayKey: WeekdayKey) => {
    const key = daySelectionKey({ slotId, dayKey });
    setSelectedDays((current) =>
      current.some((entry) => daySelectionKey(entry) === key)
        ? current.filter((entry) => daySelectionKey(entry) !== key)
        : [...current, { slotId, dayKey }]
    );
    setError('');
  };

  const handleSubmit = async () => {
    if (!profile?.uid || submitting) return;
    const nextSelections = buildDaySelections(selectedDays);
    if (ownProfile && !reason.trim()) {
      setError(pageText.teacher.reasonRequired);
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { selections: nextSelections };
      if (ownProfile) body.reason = reason.trim();
      await apiRequest('/api/v1/classes/save-availability', { method: 'POST', body });
      toast.success(ownProfile ? pageText.toast.requestSent : pageText.toast.saved);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (requestId: string, decision: 'approved' | 'rejected') => {
    if (reviewingAction) return;
    const actionKey = `${requestId}:${decision}`;
    setReviewingAction(actionKey);
    try {
      await apiRequest('/api/v1/classes/review-availability-change', {
        method: 'POST',
        body: { requestId, decision, reviewNote },
      });
      toast.success(decision === 'approved' ? pageText.toast.approved : pageText.toast.rejected);
      if (isReviewer) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: officeQueryKeys.teacherAvailabilityProfiles(identity),
          }),
          queryClient.invalidateQueries({
            queryKey: officeQueryKeys.teacherAvailabilityPending(identity),
          }),
        ]);
      }
    } finally {
      setReviewingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <CalendarDays className="h-7 w-7 text-blue-600" />
          {pageText.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{pageText.subtitle}</p>
      </div>

      {isReviewer ? (
        <div className="grid gap-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Users className="h-5 w-5 text-slate-500" />
              {pageText.reviewer.approvedTitle}
            </h2>
            {reviewerProfiles.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {pageText.reviewer.allTeachers}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {reviewerProfiles.map((teacherProfile) => (
                    <TeacherProfileButton
                      key={teacherProfile.id}
                      teacherProfile={teacherProfile}
                      active={selectedProfile?.id === teacherProfile.id}
                      onSelect={() => setSelectedProfileId(teacherProfile.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                    <th className="w-28 border-b border-r border-slate-200 px-3 py-3">
                      {pageText.reviewer.columns.day}
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3">
                      {pageText.reviewer.columns.teachers}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profilesByDay.map((day) => (
                    <tr key={day.key} className="border-b border-slate-200 last:border-b-0">
                      <th className="border-r border-slate-200 px-3 py-3 text-left font-bold text-slate-800">
                        {day.label}
                      </th>
                      <td className="px-3 py-3">
                        {day.profiles.length === 0 ? (
                          <span className="text-slate-400">{pageText.reviewer.noTeachers}</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {day.profiles.map((teacherProfile) => {
                              const busyNoteText = formatBusyClassNote(
                                busyNotesByTeacherDay.get(
                                  `${teacherProfile.teacherId}:${day.key}`
                                ) || [],
                                pageText.busyNote
                              );
                              return (
                                <TeacherProfileButton
                                  key={`${day.key}:${teacherProfile.id}`}
                                  teacherProfile={teacherProfile}
                                  active={selectedProfile?.id === teacherProfile.id}
                                  busyNoteText={busyNoteText}
                                  onSelect={() => setSelectedProfileId(teacherProfile.id)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedProfile ? (
              <div className="mt-4">
                <AvailabilityGrid
                  title={formatTemplate(pageText.grid.teacherAvailabilityTitle, {
                    teacher: selectedProfile.teacherName || selectedProfile.teacherId,
                  })}
                  slots={displaySlots}
                  selections={selectedProfile.selections || []}
                  text={pageText.grid}
                  weekDays={weekDays}
                  getBusyNotes={(slotId, dayKey) =>
                    busyNotesByTeacherCell.get(
                      teacherDayCellKey(selectedProfile.teacherId, dayKey, slotId)
                    ) || []
                  }
                />
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">{pageText.reviewer.noApproved}</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Settings className="h-5 w-5 text-slate-500" />
              {pageText.reviewer.pendingTitle}
            </h2>
            <div className="mt-4 space-y-3">
              {requests.length === 0 ? (
                <p className="text-sm text-slate-500">{pageText.reviewer.noPending}</p>
              ) : (
                requests.map((request) => {
                  const approveLoading = reviewingAction === `${request.id}:approved`;
                  const rejectLoading = reviewingAction === `${request.id}:rejected`;
                  const reviewDisabled = reviewingAction !== null;

                  return (
                    <div key={request.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{request.teacherName}</div>
                      <p className="mt-1 text-sm text-slate-500">{request.reason}</p>
                      <div className="mt-4 grid gap-3 xl:grid-cols-2">
                        <AvailabilityGrid
                          title={pageText.grid.current}
                          slots={displaySlots}
                          selections={request.currentSelections || []}
                          text={pageText.grid}
                          weekDays={weekDays}
                          getBusyNotes={(slotId, dayKey) =>
                            busyNotesByTeacherCell.get(
                              teacherDayCellKey(request.teacherId, dayKey, slotId)
                            ) || []
                          }
                        />
                        <AvailabilityGrid
                          title={pageText.grid.requested}
                          slots={displaySlots}
                          selections={request.requestedSelections || []}
                          text={pageText.grid}
                          weekDays={weekDays}
                          getBusyNotes={(slotId, dayKey) =>
                            busyNotesByTeacherCell.get(
                              teacherDayCellKey(request.teacherId, dayKey, slotId)
                            ) || []
                          }
                        />
                      </div>
                      <input
                        value={reviewNote}
                        onChange={(event) => setReviewNote(event.target.value)}
                        placeholder={pageText.reviewer.reviewNotePlaceholder}
                        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleReview(request.id, 'approved')}
                          disabled={reviewDisabled}
                          aria-busy={approveLoading}
                          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {approveLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {approveLoading ? pageText.actions.approving : pageText.actions.approve}
                        </button>
                        <button
                          onClick={() => handleReview(request.id, 'rejected')}
                          disabled={reviewDisabled}
                          aria-busy={rejectLoading}
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {rejectLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          {rejectLoading ? pageText.actions.rejecting : pageText.actions.reject}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          {pendingRequest && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {pageText.teacher.pendingBanner}
            </div>
          )}
          {pendingRequest ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <AvailabilityGrid
                title={pageText.grid.currentApproved}
                slots={displaySlots}
                selections={ownProfile?.selections || []}
                text={pageText.grid}
                weekDays={weekDays}
                hasDeclaration={Boolean(ownProfile)}
              />
              <AvailabilityGrid
                title={pageText.grid.pendingRequest}
                slots={displaySlots}
                selections={pendingRequest.requestedSelections || []}
                text={pageText.grid}
                weekDays={weekDays}
              />
            </div>
          ) : (
            <AvailabilityGrid
              title={ownProfile ? pageText.grid.newChangeRequest : pageText.grid.newAvailability}
              slots={activeSlots}
              selections={selectedDays}
              text={pageText.grid}
              weekDays={weekDays}
              hasDeclaration={Boolean(ownProfile)}
              interactive
              onToggle={toggleSelection}
            />
          )}

          {!pendingRequest && (
            <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
              {pageText.teacher.pairedDayNote}
            </p>
          )}
          {ownProfile && !pendingRequest && (
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={pageText.teacher.reasonPlaceholder}
              className="mt-4 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          )}
          {!pendingRequest && (
            <>
              {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                aria-busy={submitting}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitLabel}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
