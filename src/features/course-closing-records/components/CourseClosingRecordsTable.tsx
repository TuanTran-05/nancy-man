import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Eye, FileText, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n/useLanguage.js';
import { formatVndAmount } from '../../../lib/core/moneyFormat.js';

interface CourseClosingRecordsTableProps {
  records: any[];
  role: string;
  onDocumentPreview: (record: any, documentType: 'evaluation' | 'tuition') => void;
  onPreview: (record: any) => void;
}

function formatTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => values[key] || '');
}

function StatusBadge({ status, copy }: { status: string; copy: any }) {
  const icons: Record<string, React.ReactNode> = {
    complete: <CheckCircle2 className="h-3 w-3" />,
    ready: <CheckCircle2 className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
    not_requested: <FileText className="h-3 w-3" />,
    retrying: <RefreshCw className="h-3 w-3" />,
    failed: <AlertCircle className="h-3 w-3" />,
  };
  const tone =
    status === 'complete' || status === 'ready'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'failed'
        ? 'bg-rose-100 text-rose-800'
        : status === 'retrying' || status.startsWith('missing_')
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${tone}`}>
      {icons[status]}
      {copy.statuses[status] || status}
    </span>
  );
}

function DocumentActions({
  record,
  type,
  onDocumentPreview,
  copy,
}: {
  record: any;
  type: 'evaluation' | 'tuition';
  onDocumentPreview: CourseClosingRecordsTableProps['onDocumentPreview'];
  copy: any;
}) {
  const artifact = type === 'evaluation' ? record.evaluationDocument : record.tuitionDocument;
  if (artifact?.status !== 'ready') {
    return <StatusBadge status={artifact?.status || 'not_requested'} copy={copy} />;
  }

  const typeLabel = type === 'evaluation' ? copy.evaluation : copy.tuition;
  return (
    <button
      type="button"
      aria-label={formatTemplate(copy.openDocument, {
        type: typeLabel.toLowerCase(),
        name: record.studentName,
      })}
      onClick={() => onDocumentPreview(record, type)}
      className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50"
    >
      <Eye className="h-4 w-4" />
    </button>
  );
}

export function CourseClosingRecordsTable({
  records,
  role,
  onDocumentPreview,
  onPreview,
}: CourseClosingRecordsTableProps) {
  const { t } = useLanguage();
  const copy = t.courseClosingRecordsPage;
  const isAccounting = role === 'accounting';

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-800/50">
        <FileText className="mx-auto mb-3 h-12 w-12 text-slate-400" />
        <h3 className="font-semibold text-slate-900 dark:text-white">{copy.emptyTitle}</h3>
        <p className="mt-1 text-sm text-slate-500">{copy.emptyDescription}</p>
      </div>
    );
  }

  const groups = Array.from(
    records.reduce((map: Map<string, any[]>, record) => {
      const key = record.className || record.classId || '';
      map.set(key, [...(map.get(key) || []), record]);
      return map;
    }, new Map<string, any[]>())
  );
  const columnCount = isAccounting ? 8 : 11;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3">{copy.studentCode}</th>
              <th className="px-4 py-3">{copy.student}</th>
              <th className="px-4 py-3">{copy.teacher}</th>
              {!isAccounting && <th className="px-4 py-3">{copy.finalScore}</th>}
              {!isAccounting && <th className="px-4 py-3">{copy.classification}</th>}
              <th className="px-4 py-3">{copy.amount}</th>
              <th className="px-4 py-3">{copy.dueDate}</th>
              {!isAccounting && <th className="px-4 py-3">{copy.evaluationDocument}</th>}
              <th className="px-4 py-3">{copy.tuitionDocument}</th>
              <th className="px-4 py-3">{copy.status}</th>
              <th className="px-4 py-3">{copy.actions}</th>
            </tr>
          </thead>
          {groups.map(([className, classRecords]) => (
            <tbody key={className} className="divide-y divide-slate-200 dark:divide-slate-700/50">
              <tr className="bg-indigo-50/70 dark:bg-indigo-950/30">
                <th
                  colSpan={columnCount}
                  className="px-4 py-2 text-sm text-indigo-900 dark:text-indigo-200"
                >
                  {formatTemplate(copy.classGroup, { name: className })}
                </th>
              </tr>
              {classRecords.map((record) => (
                <tr key={record.id}>
                  <td className="px-4 py-3 font-mono text-xs">{record.studentCode || '-'}</td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {record.studentName}
                  </td>
                  <td className="px-4 py-3">{record.teacherName}</td>
                  {!isAccounting && (
                    <td className="px-4 py-3">{record.evaluationSnapshot?.totalScore ?? '-'}</td>
                  )}
                  {!isAccounting && (
                    <td className="px-4 py-3">
                      {copy.classifications[record.evaluationSnapshot?.classification] || '-'}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {record.tuitionSnapshot?.amount
                      ? formatVndAmount(record.tuitionSnapshot.amount)
                      : '-'}
                  </td>
                  <td className="px-4 py-3">{record.tuitionSnapshot?.paymentDueDate || '-'}</td>
                  {!isAccounting && (
                    <td className="px-4 py-3">
                      <DocumentActions
                        record={record}
                        type="evaluation"
                        copy={copy}
                        onDocumentPreview={onDocumentPreview}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <DocumentActions
                      record={record}
                      type="tuition"
                      copy={copy}
                      onDocumentPreview={onDocumentPreview}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={record.displayStatus} copy={copy} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label={formatTemplate(copy.previewRecord, {
                        name: record.studentName,
                      })}
                      onClick={() => onPreview(record)}
                      className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
