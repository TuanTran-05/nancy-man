import { Class } from '../../types';

/**
 * Utility to filter items by a selected term based on the class's term dates.
 */
export function filterByTerm<T>(
  items: T[],
  getDate: (item: T) => string | number | Date,
  classData: Class | null,
  selectedTerm: string
): T[] {
  if (!classData || !selectedTerm) return items;

  // If it's a specific term or 'current'
  const isCurrentTerm = selectedTerm === 'current';
  const matchedTerm = classData.terms?.find((t) => t.id === selectedTerm);

  if (isCurrentTerm || matchedTerm) {
    const allTerms = [
      ...(classData.terms || []).map((t) => ({ id: t.id, start: new Date(t.startDate).getTime() })),
      { id: 'current', start: new Date(classData.startDate).getTime() },
    ].sort((a, b) => a.start - b.start);

    if (allTerms.length === 0) return items;

    const targetTermId = isCurrentTerm ? 'current' : matchedTerm!.id;

    return items.filter((item) => {
      const explicitTermId =
        item && typeof item === 'object' && 'termId' in item
          ? String((item as { termId?: unknown }).termId || '')
          : '';
      if (explicitTermId) return explicitTermId === targetTermId;

      const itemDate = new Date(getDate(item)).getTime();

      let assignedTermId = allTerms[0].id;
      for (let i = 0; i < allTerms.length; i++) {
        if (itemDate >= allTerms[i].start) {
          assignedTermId = allTerms[i].id;
        }
      }

      if (itemDate < allTerms[0].start) {
        assignedTermId = allTerms[0].id;
      }

      return assignedTermId === targetTermId;
    });
  }

  // Fallback to simple date range if it's not a known term (though in our app it usually is)
  return items;
}
