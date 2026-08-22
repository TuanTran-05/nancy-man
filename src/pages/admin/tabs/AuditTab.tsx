import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { cn, formatVN } from '../../../lib/core/utils';
import { translations } from '../../../lib/i18n/translations';
import {
  getAuditInitial,
  getAuditActorParts,
  getAuditLookupName,
} from '../../../lib/audit/auditHelpers';
import type { AuditLogEntry } from '../../../types';
import { getAdminStaffRoleLabel } from '../../../lib/auth/staffRoles';

interface AuditTabProps {
  language: keyof typeof translations;
  t: any;
  ap: any;
  auditLogs: AuditLogEntry[];
  auditUserMap: Record<string, any>;
  studentRecords: any[];
}

export function AuditTab({
  language,
  t,
  ap,
  auditLogs,
  auditUserMap,
  studentRecords,
}: AuditTabProps) {
  return (
    <motion.div
      key="audit"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="bg-surface rounded-2xl shadow-sm border border-border-default overflow-hidden">
        <div className="p-6 border-b border-border-light bg-page/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-heading flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2 text-blue-500" />
              {t.audit.title}
            </h2>
            <p className="text-sm text-muted mt-1">{t.audit.desc}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-border-light text-sm font-semibold text-slate-600 dark:text-slate-300">
                <th className="px-6 py-4">{t.audit.table.time}</th>
                <th className="px-6 py-4">{t.audit.table.user}</th>
                <th className="px-6 py-4">{t.audit.table.action}</th>
                <th className="px-6 py-4">{t.audit.table.target}</th>
                <th className="px-6 py-4">{t.audit.table.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {auditLogs.length > 0 ? (
                auditLogs.map((log) => {
                  const dateStr = log.timestamp
                    ? formatVN(log.timestamp, 'HH:mm dd/MM/yyyy')
                    : 'N/A';
                  const actionKey = log.action as keyof typeof t.audit.actions;
                  const targetKey = log.collection as keyof typeof t.audit.targets;
                  const actionText = t.audit.actions[actionKey] || log.action;
                  const targetText = t.audit.targets[targetKey] || log.collection;
                  const actor = getAuditActorParts(log, auditUserMap);

                  let actionColor = 'bg-slate-100 text-slate-700';
                  if (log.action === 'create') actionColor = 'bg-emerald-100 text-emerald-700';
                  if (log.action === 'update') actionColor = 'bg-amber-100 text-amber-700';
                  if (log.action === 'delete') actionColor = 'bg-red-100 text-red-700';
                  if (log.action === 'status_change') actionColor = 'bg-blue-100 text-blue-700';

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm whitespace-nowrap">
                        <span className="text-slate-600 dark:text-slate-400">{dateStr}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                            {getAuditInitial(actor)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-heading">
                              {actor.name || actor.id || '-'}
                            </p>
                            <p className="text-xs text-muted capitalize">{actor.role || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={cn('px-2.5 py-1 rounded-full text-xs font-bold', actionColor)}
                        >
                          {actionText}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {targetText}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {(() => {
                            const meta = log.metadata as Record<string, unknown> | undefined;
                            const metadataName = meta
                              ? ((meta.studentName ||
                                  meta.className ||
                                  meta.staffName ||
                                  meta.staffEmail ||
                                  meta.email) as string | undefined)
                              : undefined;
                            const matchingStudent =
                              log.collection === 'students'
                                ? studentRecords.find((student) => student.id === log.documentId)
                                : undefined;
                            const lookupTargetName =
                              log.collection === 'users'
                                ? getAuditLookupName(auditUserMap[log.documentId])
                                : ((matchingStudent?.name || matchingStudent?.studentId) as
                                    | string
                                    | undefined);
                            const displayName = metadataName || lookupTargetName;
                            const metaAction = meta?.action as string | undefined;
                            const staffRole = meta?.staffRole as string | undefined;
                            const actionLabels: Record<string, string> = {
                              'evaluation-insights': ap.viewEvaluation,
                              'update-profile': ap.updateProfile,
                              revoke_access: ap.revokeAccess,
                              unblock_access: ap.unblockAccess,
                            };
                            const roleLabel =
                              staffRole === 'admin'
                                ? ap.adminRole
                                : getAdminStaffRoleLabel(ap, staffRole);
                            const fallbackId =
                              !displayName && log.documentId ? log.documentId : undefined;
                            return (
                              <>
                                {(displayName || fallbackId) && (
                                  <p className="font-medium text-slate-800 dark:text-slate-200">
                                    {displayName || fallbackId}
                                  </p>
                                )}
                                {staffRole && <p className="text-xs text-muted">{roleLabel}</p>}
                                {metaAction && actionLabels[metaAction] && (
                                  <p className="text-xs text-blue-600 dark:text-blue-400">
                                    {actionLabels[metaAction]}
                                  </p>
                                )}
                              </>
                            );
                          })()}
                          {log.changes && Object.keys(log.changes).length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {Object.entries(log.changes).map(([field, change]) => {
                                const fieldKey = field as keyof typeof t.audit.fields;
                                const fieldLabel = t.audit.fields[fieldKey] || field;
                                const c = change as { before: unknown; after: unknown };
                                return (
                                  <p key={field} className="text-xs">
                                    <span className="text-muted">{fieldLabel}:</span>{' '}
                                    <span className="line-through text-red-400">
                                      {String(c.before)}
                                    </span>
                                    {' → '}
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                      {String(c.after)}
                                    </span>
                                  </p>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted">
                    {t.audit.noLogs}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
