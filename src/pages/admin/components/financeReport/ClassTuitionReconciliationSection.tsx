import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Scale } from 'lucide-react';
import {
  fetchClassReconciliationOptions,
  fetchClassTuitionReconciliation,
} from '../../../../lib/api/financeApi';
import type {
  ClassReconciliationClassOption,
  ClassReconciliationCourseOption,
  ClassTuitionReconciliationResponse,
  ClassTuitionRowFilter,
  ClassTuitionStudentRow,
} from '../../../../../shared/classTuitionReconciliation';
import { formatClassNameWithTeacher } from '../../../../lib/classes/sortClasses';
import { ClassCombobox, type ClassComboboxOption } from './ClassCombobox';
import { ClassTuitionReconciliationView } from './ClassTuitionReconciliationView';
import { ClassTuitionStudentDetailModal } from './ClassTuitionStudentDetailModal';
import type { ClassTuitionReconciliationText } from './types';

export type ClassTuitionReconciliationSectionProps = {
  language: 'vi' | 'en';
  t: ClassTuitionReconciliationText;
};

type ClassOption = ClassReconciliationClassOption;

type ScopedRequestState<T> =
  | { key: string; status: 'loading' }
  | { key: string; status: 'success'; data: T }
  | { key: string; status: 'error'; errorCode?: string; message: string };

function toErrorState(
  key: string,
  error: unknown,
  t: ClassTuitionReconciliationText
): ScopedRequestState<never> {
  const typed = error as { errorCode?: string; message?: string } | null;
  const errorCode = typed?.errorCode;
  const message =
    errorCode === 'class_reconciliation_too_large' ? t.tooLarge : typed?.message || t.loadError;
  return { key, status: 'error', errorCode, message };
}

function RequestError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border-default p-6 text-sm text-subtle">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </div>
  );
}

/**
 * Owns the class -> course -> report request chain. Deliberately takes neither the
 * month nor the center report: this block is whole-course scoped and must survive
 * every month change on the page around it.
 */
export function ClassTuitionReconciliationSection({
  language,
  t,
}: ClassTuitionReconciliationSectionProps) {
  const [classesState, setClassesState] = useState<ScopedRequestState<ClassOption[]> | null>(null);
  const [classesNonce, setClassesNonce] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState('');

  const [coursesState, setCoursesState] = useState<ScopedRequestState<
    ClassReconciliationCourseOption[]
  > | null>(null);
  const [coursesNonce, setCoursesNonce] = useState(0);
  const [selectedTermStart, setSelectedTermStart] = useState('');

  const [reportState, setReportState] =
    useState<ScopedRequestState<ClassTuitionReconciliationResponse> | null>(null);
  const [reportNonce, setReportNonce] = useState(0);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClassTuitionRowFilter>('all');
  const [detailRow, setDetailRow] = useState<ClassTuitionStudentRow | null>(null);

  useEffect(() => {
    const key = 'classes';
    const controller = new AbortController();
    setClassesState({ key, status: 'loading' });

    fetchClassReconciliationOptions(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setClassesState({
          key,
          status: 'success',
          data: response.mode === 'classes' ? response.classes : [],
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setClassesState(toErrorState(key, error, t));
      });

    return () => controller.abort();
  }, [classesNonce, t]);

  useEffect(() => {
    if (!selectedClassId) {
      setCoursesState(null);
      return;
    }

    const key = `courses:${selectedClassId}`;
    const controller = new AbortController();
    setCoursesState({ key, status: 'loading' });

    fetchClassReconciliationOptions(selectedClassId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const courses = response.mode === 'courses' ? response.courses : [];
        setCoursesState((current) =>
          current?.key === key ? { key, status: 'success', data: courses } : current
        );
        const current = courses.filter((option) => option.isCurrent);
        if (current.length === 1) setSelectedTermStart(current[0].termStart);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCoursesState((current) =>
          current?.key === key ? toErrorState(key, error, t) : current
        );
      });

    return () => controller.abort();
  }, [selectedClassId, coursesNonce, t]);

  useEffect(() => {
    if (!selectedClassId || !selectedTermStart) {
      setReportState(null);
      return;
    }

    const key = `report:${selectedClassId}:${selectedTermStart}`;
    const controller = new AbortController();
    setReportState({ key, status: 'loading' });

    fetchClassTuitionReconciliation({
      classId: selectedClassId,
      termStart: selectedTermStart,
      signal: controller.signal,
    })
      .then((report) => {
        if (controller.signal.aborted) return;
        setReportState((current) =>
          current?.key === key ? { key, status: 'success', data: report } : current
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setReportState((current) => (current?.key === key ? toErrorState(key, error, t) : current));
      });

    return () => controller.abort();
  }, [selectedClassId, selectedTermStart, reportNonce, t]);

  const handleSelectClass = useCallback((classId: string) => {
    setSelectedClassId(classId);
    setSelectedTermStart('');
    setCoursesState(null);
    setReportState(null);
    setSearch('');
    setFilter('all');
    setDetailRow(null);
  }, []);

  const handleSelectCourse = useCallback((termStart: string) => {
    setSelectedTermStart(termStart);
    setReportState(null);
    setSearch('');
    setFilter('all');
    setDetailRow(null);
  }, []);

  // Memoised so the `[]` fallback is not a fresh array on every render, which would
  // rebuild the combobox options — and reset its keyboard highlight — on each keystroke.
  const classes = useMemo(
    () => (classesState?.status === 'success' ? classesState.data : []),
    [classesState]
  );

  /**
   * `formatClassNameWithTeacher` is the same helper the tuition filters and the
   * student workspace use, so a class reads identically everywhere. It already
   * prefers a resolved `teacherName`, which the options API now supplies, so no
   * teacher lookup table has to be threaded through this section.
   */
  const classOptions = useMemo<ClassComboboxOption[]>(
    () =>
      classes.map((option) => ({
        id: option.id,
        label: `${formatClassNameWithTeacher(option)} · ${t.classStatusLabels[option.status]}`,
        searchText: `${option.name} ${option.teacherName}`,
      })),
    [classes, t]
  );

  const courses = coursesState?.status === 'success' ? coursesState.data : [];

  return (
    <section aria-labelledby="class-reconciliation-title" className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Scale className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="class-reconciliation-title" className="text-lg font-black text-heading">
            {t.title}
          </h2>
          <p className="text-sm text-subtle">{t.subtitle}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ClassCombobox
          options={classOptions}
          value={selectedClassId}
          onChange={handleSelectClass}
          label={t.classLabel}
          placeholder={t.classSearch}
          emptyText={t.noClassMatches}
          clearLabel={t.clearClass}
          disabled={classesState?.status === 'loading'}
        />

        <label className="flex flex-col text-xs font-semibold text-slate-500">
          {t.courseLabel}
          <select
            value={selectedTermStart}
            onChange={(event) => handleSelectCourse(event.target.value)}
            disabled={!selectedClassId || coursesState?.status !== 'success'}
            className="mt-1 h-11 rounded-xl border border-border-default bg-surface px-3 text-sm font-semibold text-heading outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          >
            <option value="">{t.selectCourse}</option>
            {courses.map((option) => (
              <option key={option.key} value={option.termStart}>
                {option.label}
                {option.isCurrent ? ` · ${t.currentCourse}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {classesState?.status === 'loading' && <Pending label={t.loadingClasses} />}
      {classesState?.status === 'error' && (
        <RequestError
          message={classesState.message}
          retryLabel={t.retry}
          onRetry={() => setClassesNonce((value) => value + 1)}
        />
      )}

      {coursesState?.status === 'loading' && <Pending label={t.loadingCourses} />}
      {coursesState?.status === 'error' && (
        <RequestError
          message={coursesState.message}
          retryLabel={t.retry}
          onRetry={() => setCoursesNonce((value) => value + 1)}
        />
      )}
      {coursesState?.status === 'success' && courses.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-default py-10 text-center text-sm text-subtle">
          {t.noCourses}
        </div>
      )}

      {reportState?.status === 'loading' && <Pending label={t.loadingReport} />}
      {reportState?.status === 'error' && (
        <RequestError
          message={reportState.message}
          retryLabel={t.retry}
          onRetry={() => setReportNonce((value) => value + 1)}
        />
      )}
      {reportState?.status === 'success' && (
        <ClassTuitionReconciliationView
          report={reportState.data}
          search={search}
          filter={filter}
          language={language}
          t={t}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onViewDetails={setDetailRow}
        />
      )}

      {detailRow && selectedClassId && selectedTermStart && (
        <ClassTuitionStudentDetailModal
          row={detailRow}
          classId={selectedClassId}
          termStart={selectedTermStart}
          language={language}
          t={t}
          onClose={() => setDetailRow(null)}
        />
      )}
    </section>
  );
}
