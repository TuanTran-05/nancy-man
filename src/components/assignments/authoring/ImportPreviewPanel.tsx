import {
  AlertTriangle,
  Download,
  FileDown,
  FileUp,
  Loader2,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import {
  downloadAuthoringImportTemplate,
  previewAuthoringImport,
  type AuthoringImportTemplateFormat,
} from '../../../lib/api/assignmentAuthoringApi';
import {
  buildAuthoringImportIssuesCsv,
  validateAuthoringImportRows,
  type AuthoringImportEditableRow,
  type AuthoringImportMode,
  type AuthoringImportPreview,
} from '../../../../shared/assignmentAuthoring';

interface ImportPreviewPanelProps {
  onApply: (preview: AuthoringImportPreview, mode: AuthoringImportMode) => void;
}

function issueTone(severity: 'warning' | 'error') {
  return severity === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function rowHasError(preview: AuthoringImportPreview, row: AuthoringImportEditableRow) {
  return preview.issues.some((issue) => issue.severity === 'error' && issue.row === row.sourceRow);
}

const REPAIR_FIELDS: Array<{
  field: keyof AuthoringImportEditableRow;
  label: string;
  wide?: boolean;
}> = [
  { field: 'section', label: 'Section' },
  { field: 'skill', label: 'Skill' },
  { field: 'responseMode', label: 'Response mode' },
  { field: 'prompt', label: 'Prompt', wide: true },
  { field: 'instructions', label: 'Instructions', wide: true },
  { field: 'optionA', label: 'Option A' },
  { field: 'optionB', label: 'Option B' },
  { field: 'optionC', label: 'Option C' },
  { field: 'optionD', label: 'Option D' },
  { field: 'correctAnswer', label: 'Correct answer' },
  { field: 'acceptedAnswers', label: 'Accepted answers' },
  { field: 'points', label: 'Points' },
  { field: 'level', label: 'Level' },
  { field: 'mediaUrl', label: 'Media URL', wide: true },
  { field: 'mediaType', label: 'Media type' },
  { field: 'transcript', label: 'Transcript', wide: true },
];

export function ImportPreviewPanel({ onApply }: ImportPreviewPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AuthoringImportPreview | null>(null);
  const [error, setError] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [repairRows, setRepairRows] = useState<AuthoringImportEditableRow[]>([]);
  const [repairRowsDirty, setRepairRowsDirty] = useState(false);

  const canApply = !!preview && preview.validQuestions > 0 && preview.sections.length > 0;

  const runPreview = async () => {
    if (!file || isLoading) return;
    setIsLoading(true);
    setError('');
    setPreview(null);
    setRepairRows([]);
    try {
      const nextPreview = await previewAuthoringImport(file);
      setPreview(nextPreview);
      setRepairRows(nextPreview.editableRows || []);
      setRepairRowsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview import');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTemplate = async (format: AuthoringImportTemplateFormat) => {
    setTemplateError('');
    try {
      const template = await downloadAuthoringImportTemplate(format);
      downloadBlob(template.filename, template.blob);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Could not download template');
    }
  };

  const updateRepairRow = (
    rowId: string,
    field: keyof AuthoringImportEditableRow,
    value: string
  ) => {
    setRepairRows((rows) =>
      rows.map((row) => (row.rowId === rowId ? { ...row, [field]: value } : row))
    );
    setRepairRowsDirty(true);
  };

  const revalidateRows = () => {
    if (!preview) return;
    const nextPreview = validateAuthoringImportRows({
      source: preview.source,
      filename: preview.filename,
      rows: repairRows,
    });
    setPreview(nextPreview);
    setRepairRows(nextPreview.editableRows || []);
    setRepairRowsDirty(false);
  };

  const exportIssues = () => {
    if (!preview || preview.issues.length === 0) return;
    downloadBlob(
      `${preview.filename.replace(/\.[^.]+$/, '')}-import-issues.csv`,
      new Blob([buildAuthoringImportIssuesCsv(preview)], { type: 'text/csv;charset=utf-8' })
    );
  };

  const apply = (mode: AuthoringImportMode) => {
    if (!preview) return;
    const latestPreview =
      repairRowsDirty && repairRows.length > 0
        ? validateAuthoringImportRows({
            source: preview.source,
            filename: preview.filename,
            rows: repairRows,
          })
        : preview;

    if (repairRowsDirty && repairRows.length > 0) {
      setPreview(latestPreview);
      setRepairRows(latestPreview.editableRows || []);
      setRepairRowsDirty(false);
    }
    if (latestPreview.validQuestions === 0 || latestPreview.sections.length === 0) return;

    onApply(latestPreview, mode);
    setPreview(null);
    setFile(null);
    setRepairRows([]);
    setRepairRowsDirty(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase text-slate-500">Import</h2>
        <span className="text-xs font-bold text-slate-400">XLSX CSV DOCX</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['xlsx', 'csv', 'docx'] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => void downloadTemplate(format)}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download {format.toUpperCase()} template
          </button>
        ))}
      </div>
      {templateError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {templateError}
        </div>
      )}

      <label className="block text-xs font-bold uppercase text-slate-500">
        Import assignment file
        <input
          aria-label="Import assignment file"
          type="file"
          accept=".xlsx,.csv,.docx"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setPreview(null);
            setError('');
            setRepairRows([]);
            setRepairRowsDirty(false);
          }}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={() => void runPreview()}
        disabled={!file || isLoading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        Preview import
      </button>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-slate-50 px-2 py-2 font-bold text-slate-700">
              {preview.validQuestions} valid
            </div>
            <div className="rounded-md bg-slate-50 px-2 py-2 font-bold text-slate-700">
              {preview.totalQuestions} total
            </div>
            <div className="rounded-md bg-amber-50 px-2 py-2 font-bold text-amber-700">
              {preview.warningCount} warning
            </div>
            <div className="rounded-md bg-red-50 px-2 py-2 font-bold text-red-700">
              {preview.errorCount} error
            </div>
          </div>

          <div className="space-y-2">
            {preview.sections.slice(0, 3).map((section) => (
              <div key={`${section.title}-${section.skill}`} className="rounded-md bg-slate-50 p-2">
                <div className="text-sm font-black text-slate-800">{section.title}</div>
                <div className="text-xs font-semibold text-slate-500">
                  {section.questions.length} question
                </div>
              </div>
            ))}
          </div>

          {preview.issues.length > 0 && (
            <div className="max-h-40 space-y-2 overflow-auto">
              {preview.issues.slice(0, 8).map((issue, index) => (
                <div
                  key={`${issue.code}-${issue.row || issue.questionNumber || index}`}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${issueTone(issue.severity)}`}
                >
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {issue.row
                      ? `Row ${issue.row}`
                      : issue.questionNumber
                        ? `Question ${issue.questionNumber}`
                        : issue.severity}
                  </div>
                  <div className="mt-1">{issue.message}</div>
                </div>
              ))}
            </div>
          )}

          {preview.issues.length > 0 && (
            <button
              type="button"
              onClick={exportIssues}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <FileDown className="h-4 w-4" />
              Export issue CSV
            </button>
          )}

          {repairRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase text-slate-500">Repair rows</h3>
                <button
                  type="button"
                  onClick={revalidateRows}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Revalidate import rows
                </button>
              </div>
              <div className="max-h-80 space-y-3 overflow-auto">
                {repairRows.map((row) => {
                  const hasError = preview ? rowHasError(preview, row) : false;
                  return (
                    <div
                      key={row.rowId}
                      className={`rounded-md border p-2 ${hasError ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
                    >
                      <div className="mb-2 text-xs font-black text-slate-600">
                        Row {row.sourceRow || row.rowId}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {REPAIR_FIELDS.map(({ field, label, wide }) => (
                          <label
                            key={field}
                            className={
                              wide
                                ? 'col-span-2 text-xs font-bold uppercase text-slate-500'
                                : 'text-xs font-bold uppercase text-slate-500'
                            }
                          >
                            {label}
                            <input
                              aria-label={`Row ${row.sourceRow || row.rowId} ${label.toLowerCase()}`}
                              value={String(row[field] || '')}
                              onChange={(event) =>
                                updateRepairRow(row.rowId, field, event.target.value)
                              }
                              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => apply('append')}
              disabled={!canApply}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              Append to draft
            </button>
            <button
              type="button"
              onClick={() => apply('replace')}
              disabled={!canApply}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              Replace draft
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
