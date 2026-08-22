import React from 'react';
import { Loader2, Send, FileText } from 'lucide-react';
import type { CourseFeeLedger, Class, Student } from '../../../types';
import type { Tab } from '../constants';
import { STATUS_COLORS, STATUS_LABELS } from '../constants';
import { fmt, formatDate } from '../financeUtils';
import { ledgerRemaining } from '../../../../shared/money';
import { StudentProfileLink } from './StudentProfileLink';

interface LedgersTabProps {
  activeTab: Tab;
  ledgerStats: { total: number; discount: number; paid: number; remaining: number };
  classMap: Record<string, Class>;
  filteredLedgers: CourseFeeLedger[];
  studentMap: Record<string, Student>;
  actionLoading: string | null;
  isAdmin: boolean;
  language: string;
  ledgersHasMore: boolean;
  ledgersLoading: boolean;
  loadLedgers: (mode: 'append') => void;
  handleSendTuitionReminder: (l: CourseFeeLedger) => void;
  handleSendTuitionNotice: (l: CourseFeeLedger) => void;
  t: any;
}

export const LedgersTab: React.FC<LedgersTabProps> = ({
  activeTab,
  ledgerStats,
  classMap,
  filteredLedgers,
  studentMap,
  actionLoading,
  isAdmin,
  language,
  ledgersHasMore,
  ledgersLoading,
  loadLedgers,
  handleSendTuitionReminder,
  handleSendTuitionNotice,
  t,
}) => {
  if (activeTab !== 'ledgers') return null;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <p className="text-xs text-slate-500 uppercase">{t.financePage.totalDue}</p>
          <p className="text-xl font-bold text-slate-800">{fmt(ledgerStats.total)} đ</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <p className="text-xs text-slate-500 uppercase">{t.financePage.discount}</p>
          <p className="text-xl font-bold text-amber-600">{fmt(ledgerStats.discount)} đ</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <p className="text-xs text-slate-500 uppercase">{t.financePage.collected}</p>
          <p className="text-xl font-bold text-emerald-600">{fmt(ledgerStats.paid)} đ</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <p className="text-xs text-slate-500 uppercase">{t.financePage.remaining}</p>
          <p className="text-xl font-bold text-red-600">{fmt(ledgerStats.remaining)} đ</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.student}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.className}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.term}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.fee}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.discount}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.paid}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.remaining}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.status}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.reminders}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.notices}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLedgers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    {t.financePage.noLedgers}
                  </td>
                </tr>
              ) : (
                filteredLedgers.map((l) => {
                  const s = studentMap[l.studentId];
                  const c = classMap[l.classId];
                  const remaining = ledgerRemaining(l);
                  const reminderLoading = actionLoading === `tuition-reminder-${l.id}`;
                  const noticeLoading = actionLoading === `tuition-notice-${l.id}`;
                  const reminderCount = Number(l.tuitionReminderCount || 0);
                  const noticeCount = Number(l.tuitionNoticeCount || 0);
                  const noticeSent = noticeCount > 0 || Boolean(l.tuitionNoticeLastSentAt);
                  return (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <StudentProfileLink
                          studentId={l.studentId}
                          name={s?.name}
                          className="font-medium"
                        />
                        <p className="text-xs text-slate-400">{s?.code || s?.studentId}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {l.termStart && l.termEnd
                          ? `${l.termStart.slice(8, 10)}/${l.termStart.slice(5, 7)} - ${l.termEnd.slice(8, 10)}/${l.termEnd.slice(5, 7)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(l.amount)}</td>
                      <td className="px-4 py-3 text-right text-amber-600">
                        {l.discountTotal ? `-${fmt(l.discountTotal)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-600">{fmt(l.paidTotal)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{fmt(remaining)}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[l.status] || ''}`}
                        >
                          {STATUS_LABELS[l.status]?.[language] || l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="inline-flex items-center justify-center min-w-8 px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700"
                          title={
                            l.tuitionReminderLastSentAt
                              ? t.financePage.lastSent.replace(
                                  '{date}',
                                  formatDate(l.tuitionReminderLastSentAt, language)
                                )
                              : t.financePage.noRemindersSent
                          }
                        >
                          {reminderCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center min-w-8 px-2 py-1 rounded-full text-xs font-medium ${
                            noticeSent
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                          title={
                            l.tuitionNoticeLastSentAt
                              ? t.financePage.lastSent.replace(
                                  '{date}',
                                  formatDate(l.tuitionNoticeLastSentAt, language)
                                )
                              : t.financePage.noNoticesSent
                          }
                        >
                          {noticeCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          {remaining > 0 && (
                            <button
                              onClick={() => handleSendTuitionReminder(l)}
                              disabled={reminderLoading || !s?.contact}
                              className="inline-flex min-w-[128px] items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={
                                !s?.contact
                                  ? t.financePage.noParentPhone
                                  : t.financePage.sendTuitionReminder
                              }
                            >
                              {reminderLoading ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Send size={14} />
                              )}
                              {t.financePage.reminder}
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleSendTuitionNotice(l)}
                              disabled={noticeLoading || !s?.contact || noticeSent}
                              className="inline-flex min-w-[128px] items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={
                                noticeSent
                                  ? t.financePage.tuitionNotifAlreadySent
                                  : !s?.contact
                                    ? t.financePage.noParentPhone
                                    : t.financePage.sendTuitionNotif
                              }
                            >
                              {noticeLoading ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <FileText size={14} />
                              )}
                              {t.financePage.tuitionNotice}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {ledgersHasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => loadLedgers('append')}
            disabled={ledgersLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {ledgersLoading && <Loader2 size={16} className="animate-spin" />}
            {language === 'vi' ? 'Tải thêm học phí' : 'Load more ledgers'}
          </button>
        </div>
      )}
    </div>
  );
};
