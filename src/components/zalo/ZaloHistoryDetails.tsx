import { ExternalLink } from 'lucide-react';
import type { ZaloHistoryEntry } from '../../lib/zalo/zaloService';

type Props = { log: ZaloHistoryEntry; language: 'vi' | 'en' };

function Detail({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <p className="text-subtle">{label}</p>
      <p className="mt-0.5 break-all font-medium text-heading">{String(value)}</p>
    </div>
  );
}

export function ZaloHistoryDetails({ log, language }: Props) {
  const vi = language === 'vi';
  const snapshot = log.payloadCaptured ? log.payloadSnapshot : undefined;
  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label={vi ? 'Mã tin Zalo' : 'Zalo message ID'} value={log.zaloMessageId} />
        <Detail label="Template" value={log.templateName || log.templateId} />
        <Detail label="Template ID" value={log.templateId} />
        <Detail label="Tracking ID" value={log.trackingId} />
        <Detail label={vi ? 'Mã lỗi Zalo' : 'Zalo error code'} value={log.providerErrorCode} />
        <Detail label="Log ID" value={log.id} />
        <Detail label={vi ? 'Số điện thoại' : 'Phone'} value={snapshot?.phone || log.phone} />
        <Detail label="Class" value={[log.className, log.classId].filter(Boolean).join(' / ')} />
        <Detail label="Course ID" value={log.courseId} />
        <Detail label="Evaluation ID" value={log.evaluationId} />
        <Detail label="Receipt" value={log.receiptNo} />
        <Detail label="Ledger" value={log.ledgerId || log.ledgerIds?.join(', ')} />
        <Detail label={vi ? 'Người gửi' : 'Sent by'} value={log.sentByName || log.sentBy} />
      </div>

      {snapshot ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/60 dark:bg-blue-500/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-blue-800 dark:text-blue-300">
              {vi ? 'Nội dung đã gửi' : 'Captured outgoing data'}
            </p>
            {(log.templatePreviewUrl || snapshot.previewUrl) && (
              <a
                href={log.templatePreviewUrl || snapshot.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300"
              >
                {vi ? 'Xem mẫu Zalo' : 'Open Zalo preview'} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(snapshot.templateData).map(([key, value]) => (
              <div key={key} className="rounded-md bg-white/70 p-2 dark:bg-slate-950/20">
                <dt className="font-semibold text-subtle">{key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-heading">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-subtle">
            {vi ? 'Snapshot lúc' : 'Captured at'}: {snapshot.capturedAt}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
          {vi
            ? 'Bản ghi cũ chưa lưu snapshot nội dung đã gửi.'
            : 'This legacy record did not capture the outgoing payload.'}
        </p>
      )}

      {log.errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-500/10">
          <p className="font-semibold text-red-700 dark:text-red-400">
            {vi ? 'Lỗi cụ thể' : 'Exact error'}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-red-700 dark:text-red-300">
            {log.errorMessage}
          </p>
        </div>
      )}

      {log.isResend && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-300">
          <p>
            <strong>{vi ? 'Bản ghi nguồn' : 'Source log'}:</strong> {log.resendOf}
          </p>
          <p className="mt-1">
            <strong>{vi ? 'Người gửi lại' : 'Resent by'}:</strong>{' '}
            {log.resentByName || log.resentBy}
          </p>
          <p className="mt-1">
            <strong>{vi ? 'Lý do gửi lại' : 'Resend reason'}:</strong> {log.resendReason}
          </p>
        </div>
      )}

      {!log.canResend && log.reason && (
        <p className="text-amber-700 dark:text-amber-400">
          <strong>{vi ? 'Không thể gửi lại' : 'Resend unavailable'}:</strong> {log.reason}
        </p>
      )}
    </div>
  );
}
