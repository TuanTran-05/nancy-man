import { describe, expect, it } from 'vitest';
import { parseAuthoringDndId, questionDndId, sectionDndId } from './authoringDnd';

describe('authoringDnd', () => {
  it('creates and parses question ids', () => {
    const id = questionDndId('section-1', 'question-1');
    expect(id).toBe('question:section-1:question-1');
    expect(parseAuthoringDndId(id)).toEqual({
      kind: 'question',
      sectionId: 'section-1',
      questionId: 'question-1',
    });
  });

  it('creates and parses section ids', () => {
    const id = sectionDndId('section-1');
    expect(parseAuthoringDndId(id)).toEqual({
      kind: 'section',
      sectionId: 'section-1',
    });
  });
});
