import React from 'react';
import { motion } from 'framer-motion';
import { Mail, Loader2, Plus, Trash2, Shield, Users } from 'lucide-react';
import { cn, formatVN } from '../../../lib/core/utils';
import { translations } from '../../../lib/i18n/translations';
import { AllowedTeacher, BlockedTeacher, StaffProfile } from '../hooks/useAdminDashboardData';
import {
  ADMIN_STAFF_ROLES,
  adminStaffRoleAccentClasses,
  adminStaffRoleIcons,
  getAdminStaffRoleLabel,
  getAdminStaffSectionEmpty,
  getAdminStaffSectionTitle,
  isTeachingStaffRole,
} from '../../../lib/auth/staffRoles';

interface StaffTabProps {
  language: keyof typeof translations;
  t: any;
  ap: any;
  allowedTeachers: AllowedTeacher[];
  blockedTeachers: BlockedTeacher[];
  registeredStaff: StaffProfile[];
  classes: any[];
  newEmail: string;
  setNewEmail: (val: string) => void;
  actionLoading: string | null;
  confirmDelete: string | null;
  setShowCreateStaffModal: (val: boolean) => void;
  setSelectedStaffProfile: (val: StaffProfile) => void;
  handleAddEmail: (e: React.FormEvent) => Promise<void>;
  handleRemoveEmail: (email: string) => Promise<void>;
  handleUnblockEmail: (email: string) => Promise<void>;
  handleDeleteBlockedEmail: (email: string) => Promise<void>;
  handleDeleteUserAccount: (uid: string, email?: string) => Promise<void>;
}

export function StaffTab({
  language,
  t,
  ap,
  allowedTeachers,
  blockedTeachers,
  registeredStaff,
  classes,
  newEmail,
  setNewEmail,
  actionLoading,
  confirmDelete,
  setShowCreateStaffModal,
  setSelectedStaffProfile,
  handleAddEmail,
  handleRemoveEmail,
  handleUnblockEmail,
  handleDeleteBlockedEmail,
  handleDeleteUserAccount,
}: StaffTabProps) {
  const staffCopy = t.staffTab || t.teachersTab;
  const staffByRole = ADMIN_STAFF_ROLES.map((role) => ({
    role,
    title: getAdminStaffSectionTitle(t, role),
    empty: getAdminStaffSectionEmpty(t, role),
    staff: registeredStaff.filter((staffMember) => staffMember.role === role),
    Icon: adminStaffRoleIcons[role],
  }));

  return (
    <motion.div
      key="staff"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="grid grid-cols-1 lg:grid-cols-2 gap-8"
    >
      <div className="space-y-8">
        {/* Allowed Emails Management */}
        <div className="bg-surface rounded-2xl shadow-sm dark:shadow-black/20 border border-border-default overflow-hidden">
          <div className="p-6 border-b border-border-light">
            <h2 className="text-lg font-bold text-heading flex items-center">
              <Mail className="w-5 h-5 mr-2 text-blue-500" />
              {staffCopy.allowedEmails.title}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{staffCopy.allowedEmails.desc}</p>
          </div>

          <div className="p-6">
            <form onSubmit={handleAddEmail} className="flex space-x-3 mb-6">
              <input
                type="email"
                required
                placeholder={staffCopy.allowedEmails.placeholder}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex-1 px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                type="submit"
                disabled={actionLoading !== null || !newEmail.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === newEmail.trim().toLowerCase() ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                {actionLoading === newEmail.trim().toLowerCase()
                  ? ap.adding
                  : staffCopy.allowedEmails.addAction}
              </button>
            </form>

            <div className="space-y-3">
              {allowedTeachers.length === 0 ? (
                <div className="text-center py-8 text-slate-400 italic bg-page rounded-xl border border-dashed border-border-default">
                  {staffCopy.allowedEmails.empty}
                </div>
              ) : (
                allowedTeachers.map((item) => (
                  <motion.div
                    key={item.email}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between p-4 bg-page rounded-xl border border-border-light"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-surface rounded-full flex items-center justify-center shadow-sm text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-slate-700">{item.email}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveEmail(item.email)}
                      disabled={actionLoading === item.email}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 relative z-10"
                      title={staffCopy.allowedEmails.revokeTitle}
                    >
                      {actionLoading === item.email ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Blocked Emails */}
          <div className="p-6 border-t border-border-light bg-page/50">
            <h2 className="text-lg font-bold text-heading flex items-center mb-4">
              <Shield className="w-5 h-5 mr-2 text-red-500" />
              {staffCopy.blockedEmails.title}
            </h2>
            <div className="space-y-3">
              {blockedTeachers.length === 0 ? (
                <p className="text-sm text-slate-400 italic">{staffCopy.blockedEmails.desc}</p>
              ) : (
                blockedTeachers.map((item) => (
                  <div
                    key={item.email}
                    className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border-default hover:border-blue-200 transition-all shadow-sm"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-700">{item.email}</span>
                      {item.blockedAt && (
                        <span className="text-[10px] text-slate-400">
                          {ap.blockedAt}
                          {formatVN(item.blockedAt, 'dd/MM/yyyy')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 relative z-10">
                      <button
                        onClick={() => handleUnblockEmail(item.email)}
                        disabled={actionLoading === item.email}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50 px-4 py-2 hover:bg-blue-50 dark:bg-blue-500/10 rounded-lg transition-all border border-blue-100 cursor-pointer active:scale-95 shadow-sm"
                      >
                        {actionLoading === item.email ? (
                          <div className="flex items-center space-x-2">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>...</span>
                          </div>
                        ) : (
                          staffCopy.blockedEmails.unblockAction
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteBlockedEmail(item.email)}
                        disabled={actionLoading === item.email}
                        className={cn(
                          'p-2 rounded-lg transition-all disabled:opacity-50 relative z-10 cursor-pointer active:scale-90',
                          confirmDelete === item.email.toLowerCase()
                            ? 'bg-red-600 text-white animate-pulse px-3 py-1 text-[10px] font-bold'
                            : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10'
                        )}
                        title={staffCopy.blockedEmails.deleteAction}
                      >
                        {actionLoading === item.email ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : confirmDelete === item.email.toLowerCase() ? (
                          <span>{ap.confirmDelete}</span>
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Registered Staff */}
      <div className="bg-surface rounded-2xl shadow-sm dark:shadow-black/20 border border-border-default overflow-hidden">
        <div className="p-6 border-b border-border-light flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-heading flex items-center">
              <Users className="w-5 h-5 mr-2 text-emerald-500" />
              {staffCopy.registeredStaff.title}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{staffCopy.registeredStaff.desc}</p>
          </div>
          <button
            onClick={() => setShowCreateStaffModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center shadow-lg shadow-blue-200 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 mr-2" />
            {ap.createAccount}
          </button>
        </div>

        <div className="p-6">
          {registeredStaff.length === 0 ? (
            <div className="text-center py-8 text-slate-400 italic bg-page rounded-xl border border-dashed border-border-default">
              {staffCopy.registeredStaff.empty}
            </div>
          ) : (
            <div className="space-y-5">
              {staffByRole.map(({ role, title, empty, staff, Icon }) => (
                <section key={role} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center text-sm font-black uppercase tracking-wide text-slate-500">
                      <Icon className="mr-2 h-4 w-4" />
                      {title}
                    </h3>
                    <span className="rounded-full bg-page px-2.5 py-1 text-xs font-bold text-slate-500">
                      {staff.length}
                    </span>
                  </div>

                  {staff.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border-default bg-page px-4 py-5 text-center text-sm italic text-slate-400">
                      {empty}
                    </div>
                  ) : (
                    staff.map((staffMember) => {
                      const isAllowed = allowedTeachers.some((a) => a.email === staffMember.email);
                      const isBlocked = blockedTeachers.some((b) => b.email === staffMember.email);
                      const assignedClasses = isTeachingStaffRole(staffMember.role)
                        ? classes.filter((c) => c.teacherId === staffMember.uid)
                        : [];
                      const staffProfileName =
                        staffMember.displayName ||
                        staffMember.email ||
                        staffCopy.registeredStaff.noName;
                      const roleLabel = getAdminStaffRoleLabel(ap, staffMember.role);
                      const accentClass = adminStaffRoleAccentClasses[role];

                      return (
                        <motion.div
                          key={staffMember.uid}
                          role="button"
                          tabIndex={0}
                          aria-label={ap.viewStaffProfile.replace('{name}', staffProfileName)}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          onClick={() => setSelectedStaffProfile(staffMember)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            setSelectedStaffProfile(staffMember);
                          }}
                          className="flex cursor-pointer flex-col space-y-3 rounded-xl border border-border-light bg-page p-4 transition-all hover:border-blue-200 hover:bg-blue-50/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-page"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div
                                className={cn(
                                  'flex h-10 w-10 items-center justify-center rounded-full font-bold',
                                  accentClass
                                )}
                              >
                                {staffMember.displayName?.charAt(0).toUpperCase() || 'S'}
                              </div>
                              <div>
                                <p className="font-medium text-heading">
                                  {staffMember.displayName || staffCopy.registeredStaff.noName}
                                </p>
                                <p className="text-xs text-slate-500">{staffMember.email}</p>
                                <span className="mt-1 inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-slate-600">
                                  {roleLabel}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div>
                                {isAllowed ? (
                                  <span className="flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/10">
                                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    {staffCopy.registeredStaff.status.valid}
                                  </span>
                                ) : isBlocked ? (
                                  <span className="flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-600 dark:bg-red-500/10">
                                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                                    {staffCopy.registeredStaff.status.revoked}
                                  </span>
                                ) : (
                                  <span className="flex items-center rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-slate-400" />
                                    {staffCopy.registeredStaff.status.new}
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUserAccount(staffMember.uid, staffMember.email);
                                }}
                                disabled={actionLoading === staffMember.uid}
                                className={cn(
                                  'relative z-10 cursor-pointer rounded-lg p-2 transition-all active:scale-90 disabled:opacity-50',
                                  confirmDelete === staffMember.uid
                                    ? 'animate-pulse bg-red-600 px-3 py-1 text-[10px] font-bold text-white'
                                    : 'text-slate-400 hover:bg-red-50 hover:text-red-500 dark:bg-red-500/10'
                                )}
                                title={ap.deleteAccountPermanently}
                              >
                                {actionLoading === staffMember.uid ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : confirmDelete === staffMember.uid ? (
                                  <span>{ap.confirmDelete}</span>
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>

                          {isTeachingStaffRole(staffMember.role) && (
                            <div className="border-t border-border-default/60 pt-2">
                              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {staffCopy.registeredStaff.assignedClasses.replace(
                                  '{count}',
                                  assignedClasses.length.toString()
                                )}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {assignedClasses.length > 0 ? (
                                  assignedClasses.map((cls) => (
                                    <span
                                      key={cls.id}
                                      className="rounded-lg border border-border-default bg-surface px-2 py-1 text-[10px] font-bold text-slate-600"
                                    >
                                      {cls.name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] italic text-slate-400">
                                    {staffCopy.registeredStaff.unassigned}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
