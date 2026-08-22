import React, { useEffect, useState } from 'react';
import { X, Edit3, UserCheck, AlertCircle, Loader2 } from 'lucide-react';
import type { AttendanceStudentQuickProfileResponse } from '../../../shared/attendanceStudentQuickProfile';
import { ModalPortal } from '../common/ModalPortal';
import { resolveStudentFaceUrl } from '../../lib/student/faceImage';
import { formatVndAmount } from '../../lib/core/moneyFormat';

export type QuickProfileLabels = {
  title: string;
  close: string;
  retry: string;
  loading: string;
  unavailable: string;
  currentClass: string;
  status: string;
  statusActive: string;
  statusOnLeave: string;
  statusDropped: string;
  statusPromoted: string;
  dob: string;
  gender: string;
  genderMale: string;
  genderFemale: string;
  genderOther: string;
  contact: string;
  statusNote: string;
  notProvided: string;
  attendance: string;
  finance: string;
  attendedSessions: string;
  insufficientAttendance: string;
  totalPaid: string;
  totalOutstanding: string;
  noTuitionData: string;
  edit: string;
  changeStatus: string;
  editLoadError: string;
  openProfileFor: string;
};

export type QuickProfileSeedStudent = Pick<
  AttendanceStudentQuickProfileResponse['student'],
  'id' | 'name' | 'studentId' | 'faceImage' | 'faceImageStoragePath'
>;

export type AttendanceStudentQuickProfilePanelProps = {
  open: boolean;
  student: QuickProfileSeedStudent;
  data: AttendanceStudentQuickProfileResponse | null;
  loading: boolean;
  error: string | null;
  readOnly: boolean;
  canViewFinance: boolean;
  preparingEdit: boolean;
  labels: QuickProfileLabels;
  onClose: () => void;
  onRetry: () => void | Promise<void>;
  onEdit: () => void | Promise<void>;
  onChangeStatus: () => void;
};

const formatMoney = (value: number) => `${formatVndAmount(value)} ₫`;

export const AttendanceStudentQuickProfilePanel: React.FC<
  AttendanceStudentQuickProfilePanelProps
> = ({
  open,
  student,
  data,
  loading,
  error,
  readOnly,
  canViewFinance,
  preparingEdit,
  labels,
  onClose,
  onRetry,
  onEdit,
  onChangeStatus,
}) => {
  const [faceUrl, setFaceUrl] = useState<string>('');

  const targetStudent = data?.student ?? student;
  const faceImage = targetStudent.faceImage;
  const faceStoragePath = targetStudent.faceImageStoragePath;

  useEffect(() => {
    let cancelled = false;
    setFaceUrl('');
    void resolveStudentFaceUrl(student.id, faceImage, faceStoragePath)
      .then((url) => {
        if (!cancelled && url) setFaceUrl(url);
      })
      .catch(() => {
        // Fallback to initials if face URL resolution fails
      });
    return () => {
      cancelled = true;
    };
  }, [student.id, faceImage, faceStoragePath]);

  if (!open) return null;

  const initials = (targetStudent.name || '')
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'active':
        return labels.statusActive;
      case 'on_leave':
        return labels.statusOnLeave;
      case 'dropped':
        return labels.statusDropped;
      case 'promoted':
        return labels.statusPromoted;
      default:
        return labels.notProvided;
    }
  };

  const getGenderLabel = (gender?: string) => {
    switch (gender) {
      case 'male':
        return labels.genderMale;
      case 'female':
        return labels.genderFemale;
      case 'other':
        return labels.genderOther;
      default:
        return labels.notProvided;
    }
  };

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[900]">
        <div
          aria-hidden="true"
          data-testid="attendance-student-profile-backdrop"
          className="absolute inset-0 h-full w-full bg-slate-950/40"
          onClick={onClose}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="attendance-student-profile-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white dark:bg-slate-900 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 p-4">
            <h2
              id="attendance-student-profile-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {labels.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={labels.close}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Student Identity Card Header */}
            <div className="flex items-center space-x-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-blue-600 font-bold text-xl dark:bg-blue-950 dark:text-blue-300">
                {faceUrl ? (
                  <img
                    src={faceUrl}
                    alt={targetStudent.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials || '?'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">
                  {targetStudent.name}
                </h3>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {targetStudent.studentId}
                </p>
                {data?.class?.name && (
                  <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
                    {labels.currentClass}: {data.class.name}
                  </p>
                )}
              </div>
            </div>

            {/* Status & Error Live Region */}
            <div aria-live="polite" className="space-y-2">
              {loading && (
                <div className="flex items-center space-x-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>{labels.loading}</span>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  <div className="flex items-center space-x-2 min-w-0">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="truncate">{error || labels.unavailable}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRetry()}
                    className="ml-2 shrink-0 rounded bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800 transition-colors"
                  >
                    {labels.retry}
                  </button>
                </div>
              )}
            </div>

            {loading && !data ? (
              <div
                aria-hidden="true"
                data-testid="attendance-student-profile-skeleton"
                className="animate-pulse space-y-4"
              >
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="grid grid-cols-2 gap-4">
                    {[0, 1, 2, 3].map((item) => (
                      <div key={item} className="space-y-2">
                        <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                        <div className="h-5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="h-3 w-40 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="mt-3 h-6 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            ) : (
              <>
                {/* Profile Fields */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                        {labels.status}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {getStatusLabel(data?.student?.enrollmentStatus)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                        {labels.dob}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {data?.student?.dob || labels.notProvided}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                        {labels.gender}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {getGenderLabel(data?.student?.gender)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                        {labels.contact}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {data?.student?.contact || labels.notProvided}
                      </span>
                    </div>
                  </div>

                  {data?.student?.statusNote && (
                    <div className="border-t border-slate-200 dark:border-slate-700/50 pt-2 text-sm">
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                        {labels.statusNote}
                      </span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {data.student.statusNote}
                      </p>
                    </div>
                  )}
                </div>

                {/* Attendance Section */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {labels.attendance}
                  </h4>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {data?.attendance
                      ? labels.attendedSessions
                          .replace('{attended}', String(data.attendance.attendedSessions))
                          .replace('{total}', String(data.attendance.totalSessions))
                      : labels.insufficientAttendance}
                  </p>
                </div>

                {/* Finance Section (if permitted) */}
                {canViewFinance && data?.finance && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {labels.finance}
                    </h4>
                    {data.finance.hasLedgerData === false ? (
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        {labels.noTuitionData}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            {labels.totalPaid}
                          </span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(data.finance.totalPaid)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                            {labels.totalOutstanding}
                          </span>
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            {formatMoney(data.finance.totalOutstanding)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action Footer (Mutations hidden when readOnly) */}
          {!readOnly && (
            <div className="flex items-center gap-3 border-t border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => void onEdit()}
                disabled={preparingEdit}
                className="flex-1 inline-flex items-center justify-center space-x-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {preparingEdit ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Edit3 className="h-4 w-4" />
                )}
                <span>{labels.edit}</span>
              </button>
              <button
                type="button"
                onClick={onChangeStatus}
                className="flex-1 inline-flex items-center justify-center space-x-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <UserCheck className="h-4 w-4" />
                <span>{labels.changeStatus}</span>
              </button>
            </div>
          )}
        </section>
      </div>
    </ModalPortal>
  );
};
