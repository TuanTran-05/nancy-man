/**
 * Where a student profile page should actually live in the address bar.
 *
 * Links to a student outlive the student's record: a receipt from last term, a
 * bookmark, a message a teacher sent a colleague. When a merge retires the
 * profile those links name, the server still answers — it resolves forward —
 * but the URL keeps the retired id. Left alone it gets bookmarked again and
 * shared again, and the retired id spreads instead of dying out.
 *
 * So the page moves the browser to the canonical id and replaces the history
 * entry rather than pushing one: the retired URL is not somewhere the user
 * chose to be, and leaving it in the back stack means Back returns to it.
 */
export function canonicalProfileRedirect(input: {
  requestedStudentId: string;
  canonicalProfileId?: string | null;
  search?: string;
}): { pathname: string; search: string } | null {
  const canonicalId = String(input.canonicalProfileId || '').trim();
  if (!canonicalId) return null;
  if (canonicalId === input.requestedStudentId) return null;
  return {
    pathname: `/students/${encodeURIComponent(canonicalId)}`,
    // The tab, the class filter, and anything else the user had open belong to
    // the page rather than to the id, so they survive the move.
    search: input.search || '',
  };
}
