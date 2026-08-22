import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { SafeStudent } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { apiRequest } from '../../lib/api/apiClient';
import { describeSiblingEligibility } from '../../../shared/siblingScholarship';

interface SiblingSectionProps {
  student: SafeStudent;
  siblings: SafeStudent[];
  candidates: SafeStudent[];
  canEdit: boolean;
  onChanged: () => void;
}

export function SiblingSection({
  student,
  siblings,
  candidates,
  canEdit,
  onChanged,
}: SiblingSectionProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = t.siblingSection;

  const groupId = String(student.siblingGroupId || '').trim();
  const eligibility = useMemo(
    () => describeSiblingEligibility(student, [student, ...siblings]),
    [student, siblings]
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return candidates
      .filter((s) => s.id !== student.id)
      .filter((s) => !groupId || String(s.siblingGroupId || '') !== groupId)
      .filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          String(s.studentId || '')
            .toLowerCase()
            .includes(needle)
      )
      .slice(0, 8);
  }, [candidates, student.id, groupId, query]);

  const reasonText =
    eligibility.reason === 'no_group'
      ? copy.reasonNoGroup
      : eligibility.reason === 'student_inactive'
        ? copy.reasonStudentInactive
        : eligibility.reason === 'no_active_sibling'
          ? copy.reasonNoActiveSibling
          : '';

  const submit = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      // apiClient serialises the body itself — pass the object.
      await apiRequest('/api/v1/students/siblings', { method: 'POST', body: payload });
      toast.success(copy.linkSuccess);
      setQuery('');
      onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('merge_confirmation_required') && window.confirm(copy.mergeConfirm)) {
        setBusy(false);
        await submit({ ...payload, confirmMerge: true });
        return;
      }
      toast.error(message || copy.linkFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border-default bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold text-heading">{copy.title}</h3>

      <p
        className={`text-xs font-semibold ${eligibility.eligible ? 'text-emerald-600' : 'text-subtle'}`}
      >
        {eligibility.eligible ? copy.scholarshipActive : copy.scholarshipInactive}
        {reasonText && ` — ${reasonText}`}
      </p>

      {siblings.length === 0 ? (
        <p className="text-xs text-subtle">{copy.empty}</p>
      ) : (
        <ul className="space-y-1">
          {siblings.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-heading">{member.name}</span>
              <span className="text-[11px] text-subtle">
                {member.studentId} · {member.enrollmentStatus || 'active'} ·{' '}
                {member.studentLifecycle || 'enrolled'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-2 pt-2 border-t border-border-default">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          {matches.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={busy}
              onClick={() => submit({ op: 'link', studentId: student.id, siblingId: candidate.id })}
              className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10"
            >
              {candidate.name} · {candidate.studentId}
            </button>
          ))}
          {groupId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ op: 'unlink', studentId: student.id })}
              className="text-xs font-semibold text-red-600 hover:underline"
            >
              {copy.removeButton}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
