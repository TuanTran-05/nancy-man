import React from 'react';
import { Cake, CalendarCheck, Info, Phone, School, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { enGB, vi } from 'date-fns/locale';
import type { SafeStudent } from '../../../types';
import { toDate } from '../../../lib/core/utils';
import { localize } from '../../../lib/i18n/localize';
import { SiblingSection } from '../../../components/students/SiblingSection';
import { formatStudentDate } from '../../../lib/student/formatStudentDate';

export interface StudentOverviewTabProps {
  student: SafeStudent;
  classLabel: string;
  /** `updatedAt` reaches this component straight from PostgreSQL API, so it can also
   *  be a Timestamp rather than the ISO string the type advertises. */
  parentLoginInfo?: { updatedAt: unknown } | null;
  language: string;
  t: any;
  siblings: SafeStudent[];
  siblingCandidates: SafeStudent[];
  canEditSiblings: boolean;
  onSiblingsChanged: () => void;
}

/**
 * Parent accounts written before timestamps were normalised still store
 * `updatedAt` as a PostgreSQL API Timestamp; formatting one as a date threw and took
 * the whole profile page down. An unreadable timestamp now just drops the
 * "last access" clause instead.
 */
function lastAccessLabel(updatedAt: unknown, language: string): string {
  const parsed = toDate(updatedAt);
  if (!parsed) return '';
  return formatDistanceToNow(parsed, {
    addSuffix: true,
    locale: localize(language, vi, enGB),
  });
}

export const StudentOverviewTab: React.FC<StudentOverviewTabProps> = ({
  student,
  classLabel,
  parentLoginInfo,
  language,
  t,
  siblings,
  siblingCandidates,
  canEditSiblings,
  onSiblingsChanged,
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <div className="space-y-4">
          <div className="flex min-w-0 items-start gap-3 text-slate-600" title={t.modal.dobLabel}>
            <Cake className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
            <div className="min-w-0">
              <p className="text-[10px] text-subtle font-bold uppercase tracking-widest">
                {t.modal.dobLabel}
              </p>
              <p className="break-words text-sm font-medium">{formatStudentDate(student.dob)}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 text-slate-600">
            <User className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
            <div className="min-w-0">
              <p className="text-[10px] text-subtle font-bold uppercase tracking-widest">
                {t.genderLabel}
              </p>
              <p className="break-words text-sm font-medium">
                {student.gender === 'male'
                  ? t.male
                  : student.gender === 'female'
                    ? t.female
                    : t.other}
              </p>
            </div>
          </div>
          <div
            className="flex min-w-0 items-start gap-3 text-slate-600"
            title={t.modal.enrollmentDateHelp}
          >
            <CalendarCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
            <div className="min-w-0">
              <p className="text-[10px] text-subtle font-bold uppercase tracking-widest">
                {t.modal.enrollmentDateLabel}
              </p>
              <p className="break-words text-sm font-medium">
                {student.enrollmentDate
                  ? formatStudentDate(student.enrollmentDate)
                  : student.studentLifecycle === 'pending' || student.studentLifecycle === 'trial'
                    ? t.modal.notEnrolled
                    : t.modal.enrollmentDateUnknown}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex min-w-0 items-start gap-3 text-slate-600">
            <School className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
            <div className="min-w-0">
              <p className="text-[10px] text-subtle font-bold uppercase tracking-widest">
                {t.modal.classLabel}
              </p>
              <p className="break-words text-sm font-medium">{classLabel}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 text-slate-600">
            <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
            <div className="min-w-0">
              <p className="text-[10px] text-subtle font-bold uppercase tracking-widest">
                {t.modal.contactLabel}
              </p>
              <p className="break-words text-sm font-medium">{student.contact}</p>
            </div>
          </div>
        </div>
      </div>

      {parentLoginInfo !== undefined && (
        <div className="flex items-start gap-3 rounded-2xl border border-border-light bg-page p-4 text-xs italic text-muted">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-subtle" />
          <div className="min-w-0">
            {parentLoginInfo ? (
              <span className="text-emerald-600 font-bold tracking-tight">
                {t.messages.parentLoggedIn}
                {lastAccessLabel(parentLoginInfo.updatedAt, language)
                  ? ` - ${t.lastAccess}: ${lastAccessLabel(parentLoginInfo.updatedAt, language)}`
                  : ''}
              </span>
            ) : (
              <span>{t.messages.parentNotLoggedIn}</span>
            )}
          </div>
        </div>
      )}

      <SiblingSection
        student={student}
        siblings={siblings}
        candidates={siblingCandidates}
        canEdit={canEditSiblings}
        onChanged={onSiblingsChanged}
      />
    </div>
  );
};
