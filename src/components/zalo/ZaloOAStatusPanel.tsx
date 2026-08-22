import React from 'react';
import toast from 'react-hot-toast';
import { Mail, Loader2, RefreshCw } from 'lucide-react';
import {
  getZaloLogSummary,
  getZaloStatus,
  sendZaloTestMessage,
  ZaloStatusResponse,
} from '../../lib/zalo/zaloService';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';

type ZaloLog = {
  id: string;
  studentName?: string;
  phone?: string;
  date?: string;
  type?: string;
  status?: string;
  createdAt?: string;
  errorMessage?: string;
  phoneMasked?: string;
};

export function ZaloOAStatusPanel({ language }: { language: 'vi' | 'en' }) {
  const languageState = useLanguage();
  const t = translations[language] || languageState.t;
  const [status, setStatus] = React.useState<ZaloStatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [testPhone, setTestPhone] = React.useState('');
  const [isTesting, setIsTesting] = React.useState(false);
  const [zaloLogs, setZaloLogs] = React.useState<ZaloLog[]>([]);

  React.useEffect(() => {
    checkStatus();
    void refreshLogs();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    const result = await getZaloStatus();
    setStatus(result);
    setLoading(false);
  };

  const refreshLogs = async () => {
    const result = await getZaloLogSummary();
    if (result.success) setZaloLogs(result.logs);
  };

  const handleTest = async () => {
    if (!testPhone || isTesting) return;
    setIsTesting(true);
    const result = await sendZaloTestMessage(testPhone);
    if (result.success) {
      toast.success(t.zaloStatusPanel.testSendSuccess);
    } else {
      toast.error(result.error || 'Failed');
    }
    setIsTesting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t.zaloStatusPanel.checking}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${status?.crashDetected ? 'bg-red-600' : status?.connected ? 'bg-emerald-500' : status?.configured ? 'bg-amber-500' : 'bg-red-500'}`}
          />
          <span className="text-sm font-medium text-slate-700">
            {status?.crashDetected
              ? `🔴 ${t.zaloStatusPanel.crashDetected}`
              : status?.connected
                ? `✅ ${t.zaloStatusPanel.connected}`
                : status?.configured
                  ? `🟡 ${t.zaloStatusPanel.tokenNeedsRefresh}`
                  : `❌ ${t.zaloStatusPanel.notConfigured}`}
          </span>
        </div>
        <button
          onClick={() => {
            void checkStatus();
            void refreshLogs();
          }}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          {t.zaloStatusPanel.refresh}
        </button>
      </div>

      {status?.error && (
        <div
          className={`p-3 border rounded-lg ${status.crashDetected ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'}`}
        >
          <p
            className={`text-xs font-semibold mb-1 ${status.crashDetected ? 'text-orange-700' : 'text-red-700'}`}
          >
            {status.crashDetected
              ? `⚠️ ${t.zaloStatusPanel.serverlessCrash}`
              : `⚠️ ${t.zaloStatusPanel.serverError}`}
          </p>
          <p
            className={`text-xs font-mono break-all ${status.crashDetected ? 'text-orange-600' : 'text-red-600'}`}
          >
            {status.error}
          </p>
          {status.crashDetected && (
            <p className="text-[11px] text-orange-500 mt-1.5">{t.zaloStatusPanel.checkLogs}</p>
          )}
        </div>
      )}

      {status?.connected && status.expiresIn && (
        <div className="text-xs text-slate-500">
          {t.zaloStatusPanel.tokenExpiry.replace(
            '{minutes}',
            String(Math.floor(status.expiresIn / 60))
          )}
        </div>
      )}

      {status?.oaId && (
        <div className="text-xs text-slate-500 space-y-0.5">
          <div>
            {t.zaloStatusPanel.oaId} <span className="font-mono">{status.oaId}</span>
          </div>
          {status.znsTemplateId && (
            <div>
              {t.zaloStatusPanel.templateAbsence}{' '}
              <span className="font-mono">{status.znsTemplateId}</span>
            </div>
          )}
          {status.znsOtpTemplateId && (
            <div>
              {t.zaloStatusPanel.templateOtp}{' '}
              <span className="font-mono">{status.znsOtpTemplateId}</span>
            </div>
          )}
          {status.znsEvalTemplateId && (
            <div>
              {t.zaloStatusPanel.templateEval}{' '}
              <span className="font-mono">{status.znsEvalTemplateId}</span>
            </div>
          )}
          {status.znsStaffTemplateId && (
            <div>
              {t.zaloStatusPanel.templateAccount}{' '}
              <span className="font-mono">{status.znsStaffTemplateId}</span>
            </div>
          )}
          {status.znsPaymentTemplateId && (
            <div>
              {t.zaloStatusPanel.templatePayment}{' '}
              <span className="font-mono">{status.znsPaymentTemplateId}</span>
            </div>
          )}
          {status.znsTuitionNoticeTemplateId && (
            <div>
              {t.zaloStatusPanel.templateTuitionReminder}{' '}
              <span className="font-mono">{status.znsTuitionNoticeTemplateId}</span>
            </div>
          )}
          {status.znsNextCourseTuitionTemplateId && (
            <div>
              {t.zaloStatusPanel.templateNextCourseTuition}{' '}
              <span className="font-mono">{status.znsNextCourseTuitionTemplateId}</span>
            </div>
          )}
          {status.znsRankTemplateId && (
            <div>
              {t.zaloStatusPanel.templateRank}{' '}
              <span className="font-mono">{status.znsRankTemplateId}</span>
            </div>
          )}
        </div>
      )}

      {status?.missingEnvVars && status.missingEnvVars.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-700 mb-1">
            ⚠️ {t.zaloStatusPanel.missingEnvVars}
          </p>
          <ul className="text-xs text-red-600 font-mono space-y-0.5">
            {status.missingEnvVars.map((v) => (
              <li key={v}>• {v}</li>
            ))}
          </ul>
          <p className="text-[11px] text-red-500 mt-1.5">{t.zaloStatusPanel.addEnvVars}</p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          placeholder={t.zaloStatusPanel.testPhonePlaceholder}
          className="flex-1 px-3 py-2 bg-surface border border-border-default rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button
          onClick={handleTest}
          disabled={isTesting || !testPhone}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {t.zaloStatusPanel.test}
        </button>
      </div>

      {zaloLogs.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            {t.zaloStatusPanel.recentHistory}
          </h4>
          <div className="max-h-[200px] overflow-y-auto space-y-1">
            {zaloLogs.map((log) => (
              <div
                key={log.id}
                className="text-xs py-1.5 px-2 bg-surface rounded-lg border border-border-light"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.status === 'sent' ? 'bg-emerald-500' : 'bg-red-500'}`}
                    />
                    <span className="font-medium text-slate-700 truncate">{log.studentName}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-500 truncate">{log.phoneMasked || log.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-400">{log.date}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.type === 'evaluation' || log.type === 'evaluation_notice'
                          ? 'bg-purple-100 text-purple-700'
                          : log.type === 'payment'
                            ? 'bg-emerald-100 text-emerald-700'
                            : log.type === 'staff-credentials'
                              ? 'bg-amber-100 text-amber-700'
                              : log.type === 'next_course_tuition' ||
                                  log.type === 'tuition_notice' ||
                                  log.type === 'tuition_reminder'
                                ? 'bg-cyan-100 text-cyan-700'
                                : log.type === 'rank_achievement'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {log.type === 'tuition_reminder'
                        ? language === 'vi'
                          ? 'Nhắc học phí'
                          : 'Tuition reminder'
                        : log.type === 'tuition_notice'
                          ? language === 'vi'
                            ? 'Thông báo học phí'
                            : 'Tuition notice'
                          : log.type === 'next_course_tuition'
                            ? t.zaloStatusPanel.tuition
                            : log.type === 'evaluation' || log.type === 'evaluation_notice'
                              ? t.zaloStatusPanel.evaluation
                              : log.type === 'payment'
                                ? t.zaloStatusPanel.payment
                                : log.type === 'staff-credentials'
                                  ? t.zaloStatusPanel.accountCreation
                                  : log.type === 'rank_achievement'
                                    ? t.zaloStatusPanel.rankAchievement
                                    : t.zaloStatusPanel.absence}
                    </span>
                    <span
                      title={log.errorMessage}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                    >
                      {log.status === 'sent' ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
                {log.status !== 'sent' && log.errorMessage && (
                  <div className="mt-1 pl-3 text-[11px] text-red-600 break-words">
                    {t.zaloStatusPanel.errorLabel} {log.errorMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <a
        href="/admin/zalo-oa"
        className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        {language === 'vi' ? 'Xem toàn bộ lịch sử Zalo OA' : 'View complete Zalo OA history'}
      </a>
    </div>
  );
}
