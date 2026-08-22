import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  getZaloManualTemplateDetail,
  getZaloManualTemplates,
  isValidVNPhone,
  sendZaloManualMessage,
  type ZaloTemplateDetail,
  type ZaloTemplateSummary,
} from '../../lib/zalo/zaloService';
import { ZaloActionDialog } from './ZaloActionDialog';

type Props = {
  language: 'vi' | 'en';
  onSent: (logId?: string) => void;
  disabled?: boolean;
};

export function ZaloManualSendPanel({ language, onSent, disabled = false }: Props) {
  const vi = language === 'vi';
  const [templates, setTemplates] = useState<ZaloTemplateSummary[]>([]);
  const [detail, setDetail] = useState<ZaloTemplateDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    let active = true;
    void getZaloManualTemplates().then((result) => {
      if (!active) return;
      if (result.success) {
        setTemplates(result.templates);
        setWarning(result.warning || '');
      } else setError(result.error || 'Không thể tải template.');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const canReview = useMemo(() => {
    if (!detail || !isValidVNPhone(phone)) return false;
    return detail.listParams.every(
      (param) => !param.require || param.acceptNull || Boolean((values[param.name] || '').trim())
    );
  }, [detail, phone, values]);

  const chooseTemplate = async (templateId: string) => {
    setDetail(null);
    setValues({});
    setError('');
    if (!templateId) return;
    setLoading(true);
    const result = await getZaloManualTemplateDetail(templateId);
    if (result.success && result.template) setDetail(result.template);
    else setError(result.error || 'Không thể tải chi tiết template.');
    setLoading(false);
  };

  const confirmSend = async () => {
    if (!detail || !canReview || sending) return;
    setSending(true);
    const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const result = await sendZaloManualMessage({
      templateId: detail.templateId,
      phone,
      templateData: values,
      clientRequestId: randomId,
    });
    setSending(false);
    if (!result.success) {
      toast.error(result.error || 'Gửi Zalo thất bại.');
      return;
    }
    toast.success(vi ? 'Đã gửi và lưu lịch sử Zalo.' : 'Sent and saved to Zalo history.');
    setReviewing(false);
    setDetail(null);
    setValues({});
    setPhone('');
    onSent(result.logId);
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-surface p-4 dark:border-blue-900/60">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-heading">
            {vi ? 'Gửi thủ công' : 'Manual send'}
          </h2>
          <p className="mt-1 text-sm text-subtle">
            {vi
              ? 'Chọn template đã duyệt, nhập biến và kiểm tra trước khi gửi.'
              : 'Choose an approved template, fill its variables, and review before sending.'}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      </div>

      {warning && (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{warning}</p>
      )}
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-heading">
            <span>Template</span>
            <select
              aria-label="Template"
              value={detail?.templateId || ''}
              disabled={disabled || loading}
              onChange={(event) => void chooseTemplate(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border-default bg-surface px-3 py-2"
            >
              <option value="">{vi ? 'Chọn template' : 'Select template'}</option>
              {templates.map((template) => (
                <option key={template.templateId} value={template.templateId}>
                  {template.templateName} ({template.templateId})
                </option>
              ))}
            </select>
          </label>

          {detail?.listParams.map((param) => (
            <label key={param.name} className="block text-sm font-semibold text-heading">
              <span>
                {param.name}
                {param.require && !param.acceptNull ? ' *' : ''}
              </span>
              <input
                aria-label={param.name}
                type={param.type.toUpperCase() === 'NUMBER' ? 'number' : 'text'}
                maxLength={param.maxLength > 0 ? param.maxLength : undefined}
                value={values[param.name] || ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [param.name]: event.target.value }))
                }
                className="mt-1.5 w-full rounded-lg border border-border-default bg-surface px-3 py-2"
              />
            </label>
          ))}

          <label className="block text-sm font-semibold text-heading">
            <span>{vi ? 'Số điện thoại người nhận' : 'Recipient phone'}</span>
            <input
              aria-label="Số điện thoại người nhận"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0901234567"
              className="mt-1.5 w-full rounded-lg border border-border-default bg-surface px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-xl bg-surface-alt p-4">
          <h3 className="font-semibold text-heading">
            {vi ? 'Nội dung sẽ gửi' : 'Outgoing values'}
          </h3>
          {detail ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                <span className="text-subtle">Template:</span> {detail.templateName}
              </p>
              {!reviewing && (
                <>
                  <p>
                    <span className="text-subtle">Tag:</span> {detail.templateTag || '-'}
                  </p>
                  <p>
                    <span className="text-subtle">SĐT:</span> {phone || '-'}
                  </p>
                  {detail.listParams.map((param) => (
                    <p key={param.name} className="break-words">
                      <span className="text-subtle">{param.name}:</span> {values[param.name] || '-'}
                    </p>
                  ))}
                </>
              )}
              {detail.previewUrl && (
                <a
                  href={detail.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600"
                >
                  {vi ? 'Xem mẫu Zalo' : 'Open Zalo preview'}{' '}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-subtle">
              {vi ? 'Chọn template để nhập nội dung.' : 'Select a template.'}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={disabled || !canReview}
          onClick={() => setReviewing(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {vi ? 'Kiểm tra nội dung' : 'Review message'}
        </button>
      </div>

      {detail && (
        <ZaloActionDialog
          isOpen={reviewing}
          title={vi ? 'Xác nhận gửi thủ công' : 'Confirm manual send'}
          description={
            vi
              ? 'Kiểm tra nội dung trước khi gửi qua Zalo OA.'
              : 'Review the content before sending via Zalo OA.'
          }
          closeLabel={vi ? 'Đóng' : 'Close'}
          cancelLabel={vi ? 'Quay lại' : 'Back'}
          confirmLabel={vi ? 'Xác nhận gửi' : 'Confirm send'}
          isPending={sending}
          onClose={() => setReviewing(false)}
          onConfirm={() => void confirmSend()}
        >
          <dl className="space-y-4 rounded-xl bg-surface-alt p-4 text-sm">
            <div>
              <dt className="text-subtle">Template</dt>
              <dd className="mt-1 break-words font-semibold text-heading">{detail.templateName}</dd>
            </div>
            <div>
              <dt className="text-subtle">{vi ? 'Số điện thoại' : 'Phone'}</dt>
              <dd className="mt-1 break-words font-medium text-heading">{phone}</dd>
            </div>
            {detail.listParams.map((param) => (
              <div key={param.name}>
                <dt className="text-subtle">{param.name}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-heading">
                  {values[param.name] || '-'}
                </dd>
              </div>
            ))}
          </dl>
        </ZaloActionDialog>
      )}
    </section>
  );
}
