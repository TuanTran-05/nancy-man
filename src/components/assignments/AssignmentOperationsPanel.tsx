import { useEffect, useState } from 'react';
import { X, Download, Users, CheckCircle, Clock, AlertCircle, Edit } from 'lucide-react';
import { getAssignmentProgressSummary } from '../../lib/api/assignmentOperationsApi';

interface Student {
  id: string;
  name: string;
}

interface Submission {
  id: string;
  studentId: string;
  studentName?: string;
  status?: string;
  submittedAt: string;
  grade?: number | null;
}

interface ProgressSummary {
  counts: {
    target: number;
    submitted: number;
    graded: number;
    missing: number;
    late: number;
    pendingManual: number;
  };
  missingStudents: Student[];
  manualGradingQueue: Submission[];
  lateSubmissions: Submission[];
}

interface AssignmentOperationsPanelProps {
  assignmentId: string;
  onClose: () => void;
}

export function AssignmentOperationsPanel({
  assignmentId,
  onClose,
}: AssignmentOperationsPanelProps) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const data = await getAssignmentProgressSummary<ProgressSummary>(assignmentId);
        if (active) {
          setSummary(data);
          setError(null);
        }
      } catch (err: any) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load progress summary');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [assignmentId]);

  const handleExportCSV = () => {
    if (!summary) return;
    const headers = 'type,id,name\n';
    const missingRows = summary.missingStudents
      .map((s) => `missing,${s.id},"${s.name}"`)
      .join('\n');
    const manualRows = summary.manualGradingQueue
      .map((s) => `manual,${s.id},"${s.studentName || ''}"`)
      .join('\n');
    const lateRows = summary.lateSubmissions
      .map((s) => `late,${s.id},"${s.studentName || ''}"`)
      .join('\n');

    const csvContent = headers + [missingRows, manualRows, lateRows].filter(Boolean).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `assignment-${assignmentId}-progress.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 z-50 flex flex-col transform transition-transform duration-300 ease-out">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Assignment Operations Dashboard
          </h2>
          <p className="text-xs text-slate-500">
            Monitor completion rates and manage manual grading
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {summary && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 rounded-lg transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Export progress CSV
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-500">Loading operations summary...</p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-xl flex items-start gap-3 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Failed to load summary</p>
              <p className="text-xs">{error}</p>
            </div>
          </div>
        ) : summary ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-slate-900 dark:text-white">
                  {summary.counts.target} target
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Total Students
                </span>
              </div>
              <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100/30 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-blue-600 dark:text-blue-400">
                  {summary.counts.submitted} submitted
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Submissions
                </span>
              </div>
              <div className="bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100/30 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {summary.counts.graded} graded
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Graded
                </span>
              </div>
              <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100/30 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-rose-600 dark:text-rose-400">
                  {summary.counts.missing} missing
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Missing Attempts
                </span>
              </div>
              <div className="bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100/30 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-amber-600 dark:text-amber-400">
                  {summary.counts.late} late
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Submitted Late
                </span>
              </div>
              <div className="bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-100/30 p-4 rounded-xl text-center">
                <span className="block text-2xl font-black text-indigo-600 dark:text-indigo-400">
                  {summary.counts.pendingManual} manual
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Needs Manual Grading
                </span>
              </div>
            </div>

            {/* Missing Students */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-850 px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Missing Submissions ({summary.missingStudents.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-y-auto">
                {summary.missingStudents.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    All targeted students have submitted.
                  </div>
                ) : (
                  summary.missingStudents.map((student) => (
                    <div key={student.id} className="p-3 flex items-center justify-between text-sm">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">
                        {student.name}
                      </div>
                      <div className="text-xs text-rose-500 font-bold bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded-full">
                        Missing
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Manual Grading Queue */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-850 px-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Pending Manual Grading Queue ({summary.manualGradingQueue.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-y-auto">
                {summary.manualGradingQueue.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No submissions pending manual grading.
                  </div>
                ) : (
                  summary.manualGradingQueue.map((sub) => (
                    <div key={sub.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {sub.studentName || 'Unknown Student'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Submitted at: {new Date(sub.submittedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-xs text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">
                        Needs Review
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Late Submissions */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-850 px-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Late Submissions ({summary.lateSubmissions.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-y-auto">
                {summary.lateSubmissions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">No late submissions.</div>
                ) : (
                  summary.lateSubmissions.map((sub) => (
                    <div key={sub.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {sub.studentName || 'Unknown Student'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Submitted at: {new Date(sub.submittedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-xs text-amber-500 font-bold bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">
                        Late
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
