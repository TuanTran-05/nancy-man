import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';
import { auth } from '../../lib/auth/sessionAuth';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface ImportFailure {
  row: number;
  name: string;
  field: string;
  error: string;
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  created: number;
  failed: number;
  createdStudents: Array<{ row: number; name: string; studentId: string }>;
  failures: ImportFailure[];
}

interface StudentImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (result: ImportResult) => void;
}

function downloadTemplate() {
  const link = document.createElement('a');
  link.href = `/student-import-template.xlsx?v=${Date.now()}`;
  link.download = 'student-import-template.xlsx';
  link.click();
}

export function StudentImportModal({ open, onClose, onImported }: StudentImportModalProps) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const formatText = useMemo(() => t.studentImportModal.fileHint, [t]);

  if (!open) return null;

  const handleClose = () => {
    if (isImporting) return;
    setFile(null);
    setResult(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || isImporting) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(t.studentImportModal.xlsxOnly);
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      toast.error(t.studentImportModal.authRequired);
      return;
    }

    setIsImporting(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/v1/students/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: form,
      });
      const data = (await response.json()) as ImportResult & { error?: string };
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Import failed');
      }

      setResult(data);
      onImported?.(data);
      toast.success(
        t.studentImportModal.importResult
          .replace('{created}', String(data.created))
          .replace('{failed}', String(data.failed))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t.studentImportModal.importFailed;
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <ModalPortal trapFocus>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
        <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
          <div className="p-5 border-b border-border-light flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-heading flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <span>{t.studentImportModal.title}</span>
              </h2>
              <p className="text-xs text-muted mt-1">{formatText}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isImporting}
              className="p-2 hover:bg-hover rounded-lg transition-colors disabled:opacity-50"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="flex-1">
                <span className="block text-sm font-medium text-slate-700 mb-1">
                  {t.studentImportModal.chooseFile}
                </span>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="block w-full text-sm text-muted file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
              </label>
              <button
                type="button"
                onClick={downloadTemplate}
                className="self-end px-4 py-2 border border-border-default rounded-lg text-sm font-medium text-slate-700 hover:bg-hover transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>{t.studentImportModal.downloadTemplate}</span>
              </button>
            </div>

            {result && (
              <div className="rounded-xl border border-border-light bg-page p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="font-medium text-heading">
                    {t.studentImportModal.totalRows}: {result.totalRows}
                  </div>
                  <div className="font-medium text-emerald-700">
                    {t.studentImportModal.created}: {result.created}
                  </div>
                  <div className="font-medium text-rose-700">
                    {t.studentImportModal.failed}: {result.failed}
                  </div>
                </div>

                {result.failures.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted border-b border-border-light">
                          <th className="py-2 pr-3 font-semibold">{t.studentImportModal.row}</th>
                          <th className="py-2 pr-3 font-semibold">
                            {t.studentImportModal.studentName}
                          </th>
                          <th className="py-2 pr-3 font-semibold">{t.studentImportModal.field}</th>
                          <th className="py-2 pr-3 font-semibold">{t.studentImportModal.reason}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failures.map((failure) => (
                          <tr
                            key={`${failure.row}-${failure.field}`}
                            className="border-b border-border-light/70"
                          >
                            <td className="py-2 pr-3 font-mono">{failure.row}</td>
                            <td className="py-2 pr-3">{failure.name || '-'}</td>
                            <td className="py-2 pr-3">{failure.field}</td>
                            <td className="py-2 pr-3 text-rose-700">{failure.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-muted">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t.studentImportModal.importNote}</span>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isImporting}
                className="flex-1 px-4 py-2 border border-border-default text-slate-600 font-medium rounded-lg hover:bg-hover transition-colors disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={!file || isImporting}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.studentImportModal.importing}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>{t.studentImportModal.importAction}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
