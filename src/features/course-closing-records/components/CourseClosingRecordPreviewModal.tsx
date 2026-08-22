import { X } from 'lucide-react';
import { ModalPortal } from '../../../components/common/ModalPortal.js';
import { useLanguage } from '../../../lib/i18n/useLanguage.js';
import { formatVndAmount } from '../../../lib/core/moneyFormat.js';

export function CourseClosingRecordPreviewModal({
  record,
  role,
  onClose,
}: {
  record: any;
  role: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const copy = t.courseClosingRecordsPage;
  const evaluation = role === 'accounting' ? undefined : record.evaluationSnapshot;
  const tuition = record.tuitionSnapshot;

  return (
    <ModalPortal lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/50 p-4">
        <section
          role="dialog"
          aria-modal="true"
          aria-label={copy.previewTitle}
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {copy.previewTitle}
              </h2>
              <p className="text-sm text-slate-500">
                {record.studentName} · {record.studentCode} · {record.className}
              </p>
            </div>
            <button type="button" aria-label={copy.closePreview} onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {evaluation && (
              <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold">{copy.evaluation}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt>{copy.finalScore}</dt>
                  <dd>{evaluation.totalScore}</dd>
                  <dt>{copy.classification}</dt>
                  <dd>
                    {copy.classifications[evaluation.classification] || evaluation.classification}
                  </dd>
                  <dt>{copy.positivePoints}</dt>
                  <dd>{evaluation.positivePoints?.join(', ') || '-'}</dd>
                  <dt>{copy.improvementPoints}</dt>
                  <dd>{evaluation.improvementPoints || '-'}</dd>
                </dl>
              </article>
            )}

            {tuition && (
              <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold">{copy.tuition}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt>{copy.amount}</dt>
                  <dd>{formatVndAmount(tuition.amount)}</dd>
                  <dt>{copy.dueDate}</dt>
                  <dd>{tuition.paymentDueDate || '-'}</dd>
                </dl>
              </article>
            )}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
