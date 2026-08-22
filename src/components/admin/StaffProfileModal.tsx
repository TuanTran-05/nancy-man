import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { X, UserCheck, Mail, BookOpen, Phone, CalendarDays, Clock } from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';
import { translations } from '../../lib/i18n/translations';
import { formatVN } from '../../lib/core/utils';
import { formatWeeklyClassSchedule } from '../../../shared/classSchedule';
import { formatTemplate } from '../../lib/i18n/formatTemplate';
import { calculateStaffTenure } from '../../lib/auth/staffTenure';
import {
  getAdminStaffRoleLabel,
  isTeachingStaffRole,
  type AdminStaffProfile,
} from '../../lib/auth/staffRoles';

type StaffProfile = AdminStaffProfile;

interface AssignedClass {
  id?: string;
  name?: string;
  schedule?: string;
  daysOfWeek?: number[];
  startDate?: string;
  endDate?: string;
  startTime?: string;
  weeklySessions?: any[];
}

function formatClassDateRange(cls: AssignedClass): string {
  if (!cls.startDate && !cls.endDate) return '';
  const startDate = cls.startDate ? formatVN(cls.startDate, 'dd/MM/yyyy') : 'N/A';
  const endDate = cls.endDate ? formatVN(cls.endDate, 'dd/MM/yyyy') : 'N/A';
  return `${startDate} - ${endDate}`;
}

function formatClassSchedule(cls: AssignedClass, dayLabels: readonly string[] | undefined): string {
  return formatWeeklyClassSchedule(cls, dayLabels as string[] | undefined);
}

export function StaffProfileModal({
  staff,
  assignedClasses,
  language,
  onClose,
}: {
  staff: StaffProfile | null;
  assignedClasses: AssignedClass[];
  language: keyof typeof translations;
  onClose: () => void;
}) {
  if (!staff) return null;

  const ap = translations[language].adminPage;
  const classLabels = translations[language].classes;
  const staffName = staff.displayName || staff.email || ap.noName;
  const initial = staffName.trim()[0]?.toUpperCase() || 'S';

  const isTeachingStaff = isTeachingStaffRole(staff.role);
  const roleLabel = getAdminStaffRoleLabel(ap, staff.role);
  const tenure = calculateStaffTenure(staff.createdAt, new Date());
  const startDate = tenure ? formatVN(staff.createdAt, 'dd/MM/yyyy') : '';
  const seniority = tenure
    ? formatTemplate(ap.staffSeniorityValue, {
        years: tenure.years,
        months: tenure.months,
        days: tenure.days,
      })
    : ap.staffEmploymentUnavailable;

  return (
    <ModalPortal lockScroll trapFocus>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-profile-title"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl"
        >
          <div className="relative h-28 shrink-0 bg-blue-600">
            <button
              type="button"
              aria-label={ap.close}
              onClick={onClose}
              className="absolute right-4 top-4 z-10 rounded-full bg-surface/20 p-2 text-white transition-colors hover:bg-surface/30"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="absolute -bottom-10 left-8 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-blue-100 text-3xl font-bold text-blue-600 shadow-lg">
              {initial}
            </div>
          </div>

          <div className="overflow-y-auto px-8 pb-8 pt-14">
            <div className="mb-6">
              <p className="mb-2 inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {roleLabel}
              </p>
              <h2 id="staff-profile-title" className="break-words text-2xl font-bold text-heading">
                {staffName}
              </h2>
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <UserCheck className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">{ap.fullName}</p>
                </div>
                <p className="break-words text-sm font-semibold text-heading">{staffName}</p>
              </div>
              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <Mail className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">Email</p>
                </div>
                <p className="break-all text-sm font-semibold text-heading">{staff.email}</p>
              </div>
              <div className="rounded-2xl border border-border-light bg-page p-4 sm:col-span-2">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <Phone className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">{ap.phone}</p>
                </div>
                <p className="break-words text-sm font-semibold text-heading">
                  {staff.phone || ap.noPhone}
                </p>
              </div>

              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <CalendarDays className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    {ap.staffStartDate}
                  </p>
                </div>
                <p className="break-words text-sm font-semibold text-heading">
                  {startDate || ap.staffEmploymentUnavailable}
                </p>
              </div>

              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <Clock className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    {ap.staffSeniority}
                  </p>
                </div>
                <p className="break-words text-sm font-semibold text-heading">{seniority}</p>
              </div>
            </div>

            {isTeachingStaff ? (
              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-subtle">
                    <BookOpen className="h-4 w-4" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">
                      {ap.assignedClasses}
                    </p>
                  </div>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-slate-600">
                    {assignedClasses.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {assignedClasses.length > 0 ? (
                    assignedClasses.map((cls, index) => {
                      const dateRange = formatClassDateRange(cls);
                      const schedule = formatClassSchedule(cls, classLabels.days);
                      const cardClassName =
                        'block rounded-xl border border-border-default bg-surface px-3 py-2.5';
                      const cardContent = (
                        <>
                          <p className="break-words text-sm font-bold text-heading">{cls.name}</p>
                          {(dateRange || schedule) && (
                            <div className="mt-2 grid gap-1 text-[11px] font-semibold text-muted">
                              {schedule && (
                                <div className="flex items-center gap-2">
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                  <span className="break-words">{schedule}</span>
                                </div>
                              )}
                              {dateRange && (
                                <div className="flex items-center gap-2">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                  <span>{dateRange}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );

                      return cls.id ? (
                        <Link
                          key={cls.id}
                          to={`/classes/${cls.id}`}
                          className={`${cardClassName} transition-all hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.99]`}
                        >
                          {cardContent}
                        </Link>
                      ) : (
                        <div key={`${cls.name}-${index}`} className={cardClassName}>
                          {cardContent}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-sm italic text-slate-400">{ap.unassigned}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-border-light bg-page p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <UserCheck className="h-4 w-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">{ap.systemRole}</p>
                </div>
                <p className="break-words text-sm font-semibold text-heading">{roleLabel}</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
