import { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Attendance, Student, UserProfile } from '../../types';
import { apiRequest } from '../../lib/api/apiClient';
import { countTrialAttendance, trialNeedsTeacherReview } from '../../lib/admissions/trialProgress';

export function TrialReviewPanel({
  profile,
  students,
  attendance,
  onDecisionComplete,
}: {
  profile: UserProfile | null;
  students: Student[];
  attendance: Attendance[];
  onDecisionComplete?: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<{
    studentId: string;
    decision: 'accepted' | 'rejected';
  } | null>(null);
  const readyStudents = students.filter((student) => {
    const assignedTeacher = student.teacherId || student.trialTeacherId;
    const canDecide =
      profile?.role === 'admin' || (profile?.role === 'teacher' && assignedTeacher === profile.uid);
    return canDecide && trialNeedsTeacherReview(student, attendance);
  });

  const decide = async (studentId: string, decision: 'accepted' | 'rejected') => {
    if (pendingAction) return;
    setPendingAction({ studentId, decision });
    try {
      await apiRequest('/api/v1/admissions/trial-decision', {
        method: 'POST',
        body: { studentId, decision },
      });
      toast.success(decision === 'accepted' ? 'Trial student accepted' : 'Trial student archived');
      onDecisionComplete?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update trial decision');
    } finally {
      setPendingAction(null);
    }
  };

  if (readyStudents.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-bold text-amber-900">Trial review required</h2>
      <div className="mt-3 space-y-2">
        {readyStudents.map((student) => {
          const isAccepting =
            pendingAction?.studentId === student.id && pendingAction.decision === 'accepted';
          const isRejecting =
            pendingAction?.studentId === student.id && pendingAction.decision === 'rejected';
          return (
            <div
              key={student.id}
              className="flex flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-slate-900">{student.name}</p>
                <p className="text-xs text-slate-500">
                  {countTrialAttendance(student, attendance)}/{student.trialRequiredSessions || 2}{' '}
                  trial sessions
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(student.id, 'accepted')}
                  disabled={!!pendingAction}
                  aria-busy={isAccepting}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAccepting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {isAccepting ? 'Accepting...' : 'Accept'}
                </button>
                <button
                  type="button"
                  onClick={() => decide(student.id, 'rejected')}
                  disabled={!!pendingAction}
                  aria-busy={isRejecting}
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRejecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {isRejecting ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
