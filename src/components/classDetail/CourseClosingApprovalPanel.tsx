import React from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { CourseClosingSnapshot } from '../../../shared/courseClosing';
import type { Class, UserProfile } from '../../types';
import type { ApiError } from '../../lib/api/apiClient';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { cn } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

export interface CourseClosingApprovalPanelProps {
  profile: UserProfile | null;
  classData: Class;
  snapshot: CourseClosingSnapshot | null;
  loading: boolean;
  approving: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  approve: (reason?: string) => Promise<CourseClosingSnapshot>;
}

export function CourseClosingApprovalPanel({
  profile,
  classData,
  snapshot,
  loading,
  approving,
  error,
  refresh,
  approve,
}: CourseClosingApprovalPanelProps) {
  const { t } = useLanguage();
  const copy = t.courseClosing;
  const [modalOpen, setModalOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [validationError, setValidationError] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  useBodyScrollLock(modalOpen);

  if (loading && !snapshot) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-busy="true">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          {copy.loading}
        </div>
      </section>
    );
  }

  if (error && !snapshot) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
          <div className="space-y-2">
            <p className="font-semibold text-red-800">{copy.unavailable}</p>
            <p className="text-sm text-red-700">{error.message}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              {copy.retry}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!snapshot) return null;

  const assignedTeacher =
    profile?.role === 'teacher' && String(classData.teacherId || '') === profile.uid;
  const canApprove = profile?.role === 'admin' || assignedTeacher;
  const approvalReady = snapshot.status === 'ready_for_approval' || snapshot.status === 'stale';
  const classLocked = classData.status === 'archived' || classData.status === 'paused';
  const showApprovalAction = canApprove && approvalReady;
  const staleReason = snapshot.staleReason ? copy.staleReasons[snapshot.staleReason] : '';
  const statusTone =
    snapshot.status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : snapshot.status === 'stale' || snapshot.status === 'missing_evaluations'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : snapshot.approvalValid
          ? 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-slate-200 bg-slate-50 text-slate-800';

  const submitApproval = async () => {
    const trimmedReason = reason.trim();
    if (profile?.role === 'admin' && !trimmedReason) {
      setValidationError(copy.adminReasonRequired);
      return;
    }
    setValidationError('');
    setActionError('');
    try {
      await approve(profile?.role === 'admin' ? trimmedReason : undefined);
      toast.success(copy.approvalSuccess);
      setModalOpen(false);
      setReason('');
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : copy.approvalError;
      setActionError(message);
      toast.error(message);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <h2 className="font-bold text-slate-900">{copy.title}</h2>
            </div>
            <div
              className={cn(
                'inline-flex rounded-full border px-3 py-1 text-sm font-bold',
                statusTone
              )}
            >
              {copy.statuses[snapshot.status]}
            </div>
            <p className="text-sm font-semibold text-slate-700">
              {copy.evaluationProgress
                .replace('{completed}', String(snapshot.finalEvaluationCount))
                .replace('{required}', String(snapshot.requiredStudentCount))}
            </p>
            {snapshot.status === 'stale' && staleReason && (
              <p className="text-sm text-amber-700">
                {copy.staleReason.replace('{reason}', staleReason)}
              </p>
            )}
            {snapshot.approvedAt && (
              <p className="text-xs text-slate-500">
                {copy.approvedMeta
                  .replace('{name}', snapshot.approvedBy || '—')
                  .replace('{role}', snapshot.approvedByRole || '—')
                  .replace('{time}', new Date(snapshot.approvedAt).toLocaleString())}
              </p>
            )}
          </div>

          <div className="grid min-w-[260px] grid-cols-1 gap-2 text-sm text-slate-600">
            <span>
              {copy.pendingEvaluation.replace(
                '{count}',
                String(snapshot.pendingEvaluationStudentIds.length)
              )}
            </span>
            <span>
              {copy.pendingRank.replace('{count}', String(snapshot.pendingRankStudentIds.length))}
            </span>
            <span>
              {copy.pendingTuition.replace(
                '{count}',
                String(snapshot.pendingTuitionStudentIds.length)
              )}
            </span>
            {snapshot.exemptStudentCount > 0 && (
              <span>
                {copy.exemptCount.replace('{count}', String(snapshot.exemptStudentCount))}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          {showApprovalAction && (
            <button
              type="button"
              disabled={classLocked || approving}
              onClick={() => {
                setValidationError('');
                setActionError('');
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {snapshot.status === 'stale' ? copy.renewApproval : copy.confirmOfficeSending}
            </button>
          )}
          {profile?.role === 'office' && (
            <p className="text-sm text-slate-500">{copy.officeReadOnly}</p>
          )}
          {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}
        </div>
      </section>

      <ModalPortal>
        <AnimatePresence>
          {modalOpen && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6 dark:border-slate-700">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {copy.modalTitle}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {copy.modalSummary
                        .replace('{start}', String(classData.startDate || '—'))
                        .replace('{end}', String(classData.endDate || '—'))
                        .replace('{count}', String(snapshot.requiredStudentCount))}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={copy.cancel}
                    onClick={() => setModalOpen(false)}
                  >
                    <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  </button>
                </div>

                <div className="p-6">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                    {copy.modalWarning}
                  </div>
                  {profile?.role === 'admin' && (
                    <label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {copy.adminReason}
                      <textarea
                        aria-label={copy.adminReason}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={copy.adminReasonPlaceholder}
                        className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3 font-normal text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      />
                    </label>
                  )}
                  {validationError && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{validationError}</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-100 p-5 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {copy.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={approving}
                    onClick={() => void submitApproval()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {approving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {approving ? copy.approving : copy.confirmApproval}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>
    </>
  );
}
