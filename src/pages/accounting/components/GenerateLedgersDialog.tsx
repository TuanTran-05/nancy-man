import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { runCourseFeeLedgers, type CourseFeeLedgerRun } from '../../../lib/api/classAdminApi';
import type { Student } from '../../../types';
import { fmt } from '../financeUtils';
import { ModalPortal } from '../../../components/common/ModalPortal';

export type GenerateLedgersDialogProps = {
  open: boolean;
  onClose: () => void;
  onApplied: (run: CourseFeeLedgerRun) => void;
  studentMap?: Record<string, Student>;
};

type Phase = 'previewing' | 'ready' | 'applying' | 'done' | 'error';

type DuplicateRow = CourseFeeLedgerRun['duplicateLedgers'][number];

// Doc ids are `{studentId}_{classId}_{termStart}_{termEnd}`, so three quarters of
// every id repeats the row it sits on. Only the tail says how the copies differ —
// usually a term end rewritten by a holiday extension. Ids built from values the
// id builder had to sanitise will not match the prefix; those stay whole.
function shortenLedgerId(duplicate: DuplicateRow, ledgerId: string): string {
  const prefix = `${duplicate.studentId}_${duplicate.classId}_${duplicate.termStart}_`;
  return ledgerId.startsWith(prefix) ? `…_${ledgerId.slice(prefix.length)}` : ledgerId;
}

// Duplicates cluster by class, so a class heading costs one line and saves
// repeating the class on every row.
function groupDuplicatesByClass(duplicates: DuplicateRow[], classNames: Map<string, string>) {
  const groups = new Map<string, { classId: string; className: string; rows: DuplicateRow[] }>();
  for (const duplicate of duplicates) {
    const group = groups.get(duplicate.classId);
    if (group) group.rows.push(duplicate);
    else
      groups.set(duplicate.classId, {
        classId: duplicate.classId,
        className: classNames.get(duplicate.classId) || duplicate.classId,
        rows: [duplicate],
      });
  }
  return [...groups.values()];
}

export function GenerateLedgersDialog({
  open,
  onClose,
  onApplied,
  studentMap = {},
}: GenerateLedgersDialogProps) {
  const { t } = useLanguage();
  const copy = t.financePage;
  const [run, setRun] = useState<CourseFeeLedgerRun | null>(null);
  const [processed, setProcessed] = useState(0);
  const [phase, setPhase] = useState<Phase>('previewing');
  const [error, setError] = useState('');

  const skipLabels: Record<string, string> = {
    class_not_found: copy.skipClassNotFound,
    class_archived: copy.skipClassArchived,
    tuition_not_configured: copy.skipTuitionNotConfigured,
  };

  const loadPreview = useCallback(async () => {
    setPhase('previewing');
    setRun(null);
    setProcessed(0);
    setError('');
    try {
      const preview = await runCourseFeeLedgers('preview', {
        onProgress: (partial) => setProcessed(partial.processedClasses),
      });
      setRun(preview);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || phase === 'applying') return;
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, phase]);

  if (!open) return null;

  const apply = async () => {
    setPhase('applying');
    setProcessed(0);
    try {
      const applied = await runCourseFeeLedgers('apply', {
        onProgress: (partial) => setProcessed(partial.processedClasses),
      });
      setRun(applied);
      onApplied(applied);
      // Closing while errors remain would hide unfinished work.
      if (applied.errors.length === 0) onClose();
      else setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const busy = phase === 'previewing' || phase === 'applying';
  const visiblePlan = (run?.plan || []).filter(
    (row) => row.creates.length > 0 || row.alreadyExists > 0 || row.skipReason
  );
  // Derived here rather than returned by the API: summing per-page totals
  // would count a student twice if their classes land on different pages.
  const studentCount = new Set(
    (run?.plan || []).flatMap((row) => row.creates.map((create) => create.studentId))
  ).size;
  const classCount = (run?.plan || []).filter((row) => row.creates.length > 0).length;
  const classNames = new Map(
    (run?.plan || []).map((row) => [row.classId, row.className || row.classId])
  );
  const duplicateGroups = groupDuplicatesByClass(run?.duplicateLedgers || [], classNames);

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="generate-ledgers-dialog-title"
          className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-h-[calc(100dvh-3rem)]"
        >
          <header className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-5">
            <h2 id="generate-ledgers-dialog-title" className="text-lg font-bold text-slate-800">
              {copy.generateDialogTitle}
            </h2>
          </header>

          <div
            data-testid="generate-ledgers-scroll-region"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          >
            {busy && (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                {phase === 'previewing'
                  ? copy.generatePreviewLoading
                  : copy.generateApplyLoading}{' '}
                {copy.generateProgressClasses.replace('{count}', String(processed))}
              </p>
            )}

            {phase === 'error' && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {run && phase !== 'previewing' && (
              <>
                {phase === 'done' && (
                  <p className="mt-4 text-sm font-medium text-amber-700">
                    {copy.generateDonePartial
                      .replace('{count}', String(run.createdCount))
                      .replace('{errors}', String(run.errors.length))}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs uppercase text-slate-500">{copy.generateWillCreate}</p>
                    <p className="text-xl font-bold text-slate-800">{run.createdCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs uppercase text-slate-500">{copy.generateTotalAmount}</p>
                    <p className="text-xl font-bold text-slate-800">{fmt(run.totalAmount)} đ</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs uppercase text-slate-500">{copy.generateStudentCount}</p>
                    <p className="text-xl font-bold text-slate-800">{studentCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs uppercase text-slate-500">{copy.generateClassCount}</p>
                    <p className="text-xl font-bold text-slate-800">{classCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs uppercase text-slate-500">{copy.generateAlreadyExists}</p>
                    <p className="text-xl font-bold text-slate-800">{run.skippedDuplicates}</p>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{copy.generateColumnClass}</th>
                        <th className="px-3 py-2">{copy.generateColumnFee}</th>
                        <th className="px-3 py-2">{copy.generateWillCreate}</th>
                        <th className="px-3 py-2">{copy.generateAlreadyExists}</th>
                        <th className="px-3 py-2">{copy.generateColumnSkip}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePlan.map((row) => (
                        <tr key={row.classId} className="border-t border-slate-100">
                          <td className="px-3 py-2">{row.className || row.classId}</td>
                          <td className="px-3 py-2">{fmt(row.tuitionFee)} đ</td>
                          <td className="px-3 py-2">{row.creates.length}</td>
                          <td className="px-3 py-2">{row.alreadyExists}</td>
                          <td className="px-3 py-2 text-amber-600">
                            {row.skipReason ? skipLabels[row.skipReason] || row.skipReason : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {run.duplicateLedgers.length > 0 && (
                  <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">
                      {copy.generateDuplicateTitle.replace(
                        '{count}',
                        String(run.duplicateLedgers.length)
                      )}
                    </p>
                    <p className="mt-1 text-xs">{copy.generateDuplicateHint}</p>
                    <div className="mt-3 space-y-3">
                      {duplicateGroups.map((group) => (
                        <div key={group.classId}>
                          <p className="text-xs font-semibold text-amber-900">
                            {group.className}{' '}
                            <span className="font-normal text-amber-700">
                              ·{' '}
                              {copy.generateDuplicateStudentCount.replace(
                                '{count}',
                                String(group.rows.length)
                              )}
                            </span>
                          </p>
                          <table className="mt-1 w-full text-left text-xs">
                            <thead className="text-amber-700">
                              <tr>
                                <th className="py-1 pr-3 font-medium">
                                  {copy.generateDuplicateColumnStudent}
                                </th>
                                <th className="py-1 pr-3 font-medium">
                                  {copy.generateDuplicateColumnTermStart}
                                </th>
                                <th className="py-1 font-medium">
                                  {copy.generateDuplicateColumnLedgerIds}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((duplicate) => {
                                const student = studentMap[duplicate.studentId];
                                return (
                                  <tr
                                    key={duplicate.ledgerIds.join('+')}
                                    className="border-t border-amber-200 align-top"
                                  >
                                    <td className="py-1 pr-3">
                                      {student ? (
                                        <>
                                          <span className="font-medium">{student.name}</span>
                                          {(student.code || student.studentId) && (
                                            <span className="text-amber-700">
                                              {' '}
                                              · {student.code || student.studentId}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        duplicate.studentId
                                      )}
                                    </td>
                                    <td className="whitespace-nowrap py-1 pr-3">
                                      {duplicate.termStart}
                                    </td>
                                    <td className="py-1">
                                      {/* Full ids stay reachable for the manual lookup that follows. */}
                                      <span
                                        className="break-all font-mono"
                                        title={duplicate.ledgerIds.join('\n')}
                                      >
                                        {duplicate.ledgerIds
                                          .map((ledgerId) => shortenLedgerId(duplicate, ledgerId))
                                          .join(' · ')}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {run.errors.length > 0 && (
                  <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-medium">
                      {copy.generateErrorTitle.replace('{count}', String(run.errors.length))}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {run.errors.map((row, index) => (
                        <li key={`${row.classId}-${index}`}>
                          {row.classId} — {row.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:px-5">
            <button
              type="button"
              // Closing mid-write would hide the progress and any errors it ends with.
              disabled={phase === 'applying'}
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-50"
            >
              {copy.generateClose}
            </button>
            <button
              type="button"
              disabled={phase !== 'ready' || !run || run.createdCount === 0}
              onClick={() => void apply()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {phase === 'applying' ? copy.generateApplyLoading : copy.generateConfirmAction}
            </button>
          </footer>
        </div>
        <button
          type="button"
          data-testid="generate-ledgers-backdrop"
          aria-label={`${copy.generateClose}: ${copy.generateDialogTitle}`}
          disabled={phase === 'applying'}
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm disabled:cursor-default"
          onClick={onClose}
        />
      </div>
    </ModalPortal>
  );
}
