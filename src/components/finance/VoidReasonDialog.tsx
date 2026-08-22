import { useEffect, useRef, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

export type VoidReasonDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  operationPrefix: 'receipt-void' | 'allocation-void';
  onClose: () => void;
  onConfirm: (input: { reason: string; idempotencyKey: string }) => Promise<void>;
};

function operationKey(prefix: VoidReasonDialogProps['operationPrefix']): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function VoidReasonDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  operationPrefix,
  onClose,
  onConfirm,
}: VoidReasonDialogProps) {
  useBodyScrollLock(isOpen);
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setReason('');
      setIdempotencyKey(operationKey(operationPrefix));
      setSubmitting(false);
      submittingRef.current = false;
    }
    wasOpen.current = isOpen;
  }, [isOpen, operationPrefix]);

  if (!isOpen) return null;

  function close() {
    if (submittingRef.current) return;
    setReason('');
    setIdempotencyKey('');
    onClose();
  }

  async function confirm() {
    const trimmedReason = reason.trim();
    if (!trimmedReason || !idempotencyKey || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm({ reason: trimmedReason, idempotencyKey });
      setReason('');
      setIdempotencyKey(operationKey(operationPrefix));
      onClose();
    } catch {
      // Keep both values so retrying the still-open dialog remains idempotent.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Đóng"
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          onClick={close}
          disabled={submitting}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-reason-dialog-title"
          className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-full bg-red-100 p-2 text-red-600">
              <XCircle size={22} />
            </div>
            <div>
              <h2 id="void-reason-dialog-title" className="font-bold text-slate-900">
                {title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{message}</p>
            </div>
          </div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="void-reason">
            Lý do hủy
          </label>
          <textarea
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting}
            rows={4}
            maxLength={500}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!reason.trim() || !idempotencyKey || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
