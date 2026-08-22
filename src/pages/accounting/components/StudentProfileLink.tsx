import { ExternalLink } from 'lucide-react';
import { buildStudentProfileHref } from '../studentProfileHref';

export type StudentProfileLinkProps = {
  studentId?: string | null;
  name?: string | null;
  /** Preselects a course on the profile, e.g. `{ classId, termKey }`. */
  params?: Record<string, string | undefined>;
  /** Extra classes for the rendered link or the plain-text fallback. */
  className?: string;
};

/**
 * Opens the student profile in a new browser tab so the accounting list keeps
 * its filters and scroll position. Falls back to plain text when a row has no
 * student link.
 */
export function StudentProfileLink({
  studentId,
  name,
  params,
  className = '',
}: StudentProfileLinkProps) {
  const label = String(name || '').trim();
  const id = String(studentId || '').trim();

  // A link needs a readable label, so rows whose student record has not loaded
  // stay plain text rather than becoming a link named "—".
  if (!id || !label) return <span className={className}>{label || '—'}</span>;

  return (
    <a
      href={buildStudentProfileHref(id, params)}
      target="_blank"
      rel="noopener noreferrer"
      title="Mở hồ sơ học sinh ở tab mới"
      className={`group inline-flex items-center gap-1 rounded font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${className}`}
    >
      {label}
      <ExternalLink
        size={12}
        aria-hidden="true"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </a>
  );
}
