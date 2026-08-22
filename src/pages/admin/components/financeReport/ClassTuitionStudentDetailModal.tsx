import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, X } from 'lucide-react';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import { apiDateToDisplayDate } from '../../../../lib/core/utils';
import { fetchClassTuitionStudentDetail } from '../../../../lib/api/financeApi';
import type {
  ClassTuitionStudentDetailResponse,
  ClassTuitionStudentRow,
  MoneyMetric,
} from '../../../../../shared/classTuitionReconciliation';
import type { ClassTuitionReconciliationText } from './types';

export type ClassTuitionStudentDetailModalProps = {
  row: ClassTuitionStudentRow;
  classId: string;
  termStart: string;
  language: 'vi' | 'en';
  t: ClassTuitionReconciliationText;
  onClose: () => void;
};

type DetailState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'success'; data: ClassTuitionStudentDetailResponse }
  | { key: string; status: 'error'; message: string };

function formatMoney(value: number, language: string): string {
  return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(
    Math.round(value)
  )} đ`;
}

function metricText(
  value: MoneyMetric,
  language: string,
  t: ClassTuitionReconciliationText
): string {
  return value === null ? t.incompleteData : formatMoney(value, language);
}

function displayDate(value: string): string {
  if (!value) return '—';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? apiDateToDisplayDate(value) : value;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-heading">{value}</p>
    </div>
  );
}

/**
 * Read-only drill-down for one `classId + termStart + student|ledger` scope. The
 * server is the only thing that decides which ledgers and receipts belong here;
 * this component adds no arithmetic of its own.
 */
export function ClassTuitionStudentDetailModal({
  row,
  classId,
  termStart,
  language,
  t,
  onClose,
}: ClassTuitionStudentDetailModalProps) {
  const target = row.kind === 'orphan_ledger' ? row.ledgerIds[0] : row.studentId;
  const requestKey = `detail:${classId}:${termStart}:${target ?? row.key}`;
  const [state, setState] = useState<DetailState | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ key: requestKey, status: 'loading' });

    fetchClassTuitionStudentDetail({
      classId,
      termStart,
      studentId: row.kind === 'orphan_ledger' ? undefined : (row.studentId ?? undefined),
      ledgerId: row.kind === 'orphan_ledger' ? row.ledgerIds[0] : undefined,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState((current) =>
          current?.key === requestKey ? { key: requestKey, status: 'success', data } : current
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = (error as { message?: string })?.message || t.loadError;
        setState((current) =>
          current?.key === requestKey ? { key: requestKey, status: 'error', message } : current
        );
      });

    return () => controller.abort();
    // `row.key` stands in for the row identity; the metrics on it never drive the request.
  }, [classId, termStart, requestKey, row.kind, row.studentId, row.ledgerIds, nonce, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const heading = useMemo(() => {
    if (row.kind === 'orphan_ledger') {
      return `${t.detail.title} · ${t.orphanLedger}: ${row.ledgerIds[0] ?? row.key}`;
    }
    return `${t.detail.title} · ${row.fullName || t.unknownStudent}`;
  }, [row, t]);

  const detail = state?.status === 'success' ? state.data : null;

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-surface p-5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-heading">{heading}</h3>
              {detail?.student.studentCode && (
                <p className="mt-0.5 text-xs text-subtle">{detail.student.studentCode}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.detail.close}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {state?.status === 'loading' && (
            <div className="flex items-center gap-2 py-10 text-sm text-subtle">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t.detail.loading}
            </div>
          )}

          {state?.status === 'error' && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">{state.message}</span>
              <button
                type="button"
                onClick={() => setNonce((value) => value + 1)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700"
              >
                {t.detail.retry}
              </button>
            </div>
          )}

          {detail && (
            <div className="mt-4 space-y-5">
              {detail.warnings.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.warnings.map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {t.warningLabels[code]}
                    </span>
                  ))}
                </div>
              )}

              <section>
                <h4 className="text-xs font-black tracking-wide text-subtle uppercase">
                  {t.detail.enrollments}
                </h4>
                {detail.enrollments.length === 0 ? (
                  <p className="mt-2 text-sm text-subtle">—</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.enrollments.map((enrollment) => (
                      <li
                        key={enrollment.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border-default p-3 text-sm"
                      >
                        <span className="font-mono text-xs text-subtle">{enrollment.id}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {t.statusLabels[enrollment.status]}
                        </span>
                        <span className="text-xs text-subtle">
                          {displayDate(enrollment.joinedAt)}
                          {enrollment.endedAt ? ` → ${displayDate(enrollment.endedAt)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="text-xs font-black tracking-wide text-subtle uppercase">
                  {t.detail.ledgers}
                </h4>
                {detail.ledgers.length === 0 ? (
                  <p className="mt-2 text-sm text-subtle">—</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.ledgers.map((ledger) => (
                      <li key={ledger.id} className="rounded-lg border border-border-default p-3">
                        <p className="font-mono text-xs text-subtle">{ledger.id}</p>
                        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <Field
                            label={t.detail.gross}
                            value={metricText(ledger.gross, language, t)}
                          />
                          <Field
                            label={t.detail.reduction}
                            value={metricText(ledger.reduction, language, t)}
                          />
                          <Field
                            label={t.detail.netDue}
                            value={metricText(ledger.netDue, language, t)}
                          />
                          <Field
                            label={t.detail.paid}
                            value={metricText(ledger.paid, language, t)}
                          />
                          <Field
                            label={t.detail.outstanding}
                            value={metricText(ledger.outstanding, language, t)}
                          />
                          <Field
                            label={t.detail.overpaid}
                            value={metricText(ledger.overpaid, language, t)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="text-xs font-black tracking-wide text-subtle uppercase">
                  {t.detail.allocations}
                </h4>
                {detail.allocations.length === 0 ? (
                  <p className="mt-2 text-sm text-subtle">{t.detail.emptyAllocations}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.allocations.map((allocation) => (
                      <li
                        key={`${allocation.receiptId}:${allocation.allocatedAmount}`}
                        className="rounded-lg border border-border-default p-3"
                      >
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <Field label={t.detail.receiptNo} value={allocation.receiptNo || '—'} />
                          <Field
                            label={t.detail.receivedDate}
                            value={displayDate(allocation.receivedDate)}
                          />
                          <Field
                            label={t.detail.paymentMethod}
                            value={allocation.paymentMethod || t.detail.unknownPaymentMethod}
                          />
                          <Field
                            label={t.detail.allocatedAmount}
                            value={formatMoney(allocation.allocatedAmount, language)}
                          />
                          {allocation.discountAmount > 0 && (
                            <>
                              <Field
                                label={t.detail.discountAmount}
                                value={formatMoney(allocation.discountAmount, language)}
                              />
                              <Field
                                label={t.detail.discountType}
                                value={allocation.discountType || t.detail.unclassifiedDiscount}
                              />
                            </>
                          )}
                        </div>
                        {allocation.note && (
                          <p className="mt-2 text-xs text-subtle">
                            {t.detail.note}: {allocation.note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {detail.workspaceUrl && (
                <a
                  href={detail.workspaceUrl}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t.detail.openWorkspace}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
