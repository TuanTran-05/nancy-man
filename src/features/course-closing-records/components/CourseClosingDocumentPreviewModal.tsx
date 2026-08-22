import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { ModalPortal } from '../../../components/common/ModalPortal.js';
import { useLanguage } from '../../../lib/i18n/useLanguage.js';

export interface CourseClosingDocumentPreviewModalProps {
  studentName: string;
  documentType: 'evaluation' | 'tuition';
  viewerUrl?: string;
  isLoading: boolean;
  error?: string;
  isDownloading: boolean;
  downloadError?: string;
  onRetry: () => void;
  onDownload: () => void;
  onClose: () => void;
}

export function CourseClosingDocumentPreviewModal({
  studentName,
  documentType,
  viewerUrl,
  isLoading,
  error,
  isDownloading,
  downloadError,
  onRetry,
  onDownload,
  onClose,
}: CourseClosingDocumentPreviewModalProps) {
  const { t } = useLanguage();
  const copy = t.courseClosingRecordsPage;
  const typeLabel = documentType === 'evaluation' ? copy.evaluation : copy.tuition;
  const title = copy.documentPreviewTitle
    .replace('{type}', typeLabel)
    .replace('{name}', studentName);

  return (
    <ModalPortal lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4">
        <section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        >
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <h2 className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onDownload}
                disabled={!viewerUrl || isDownloading}
                aria-label={isDownloading ? copy.downloadingDocument : copy.downloadDocument}
                aria-busy={isDownloading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">
                  {isDownloading ? copy.downloadingDocument : copy.downloadDocument}
                </span>
              </button>
              <button type="button" aria-label={copy.closeDocumentPreview} onClick={onClose}>
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="border-b border-sky-100 bg-sky-50 px-5 py-2 text-xs font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            {copy.docxViewerHint}
          </div>

          {downloadError && (
            <div
              role="alert"
              className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {downloadError}
            </div>
          )}

          <div className="min-h-0 flex-1 bg-slate-100 dark:bg-slate-950">
            {isLoading ? (
              <div role="status" className="flex h-full items-center justify-center">
                {copy.loadingDocumentPreview}
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
                <p role="alert" className="text-rose-600">
                  {error}
                </p>
                <button type="button" onClick={onRetry} className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {copy.retryDocumentPreview}
                </button>
              </div>
            ) : viewerUrl ? (
              <iframe
                title={title}
                src={viewerUrl}
                className="h-full w-full border-0 bg-white"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div role="alert" className="flex h-full items-center justify-center text-rose-600">
                {copy.documentPreviewError}
              </div>
            )}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
