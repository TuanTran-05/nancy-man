export type AuthoringDndId =
  | { kind: 'section'; sectionId: string }
  | { kind: 'question'; sectionId: string; questionId: string };

export function sectionDndId(sectionId: string) {
  return `section:${sectionId}`;
}

export function questionDndId(sectionId: string, questionId: string) {
  return `question:${sectionId}:${questionId}`;
}

export function parseAuthoringDndId(raw: string): AuthoringDndId {
  const [kind, sectionId, questionId] = raw.split(':');
  if (kind === 'section' && sectionId) return { kind, sectionId };
  if (kind === 'question' && sectionId && questionId) return { kind, sectionId, questionId };
  throw new Error(`Invalid authoring dnd id: ${raw}`);
}
