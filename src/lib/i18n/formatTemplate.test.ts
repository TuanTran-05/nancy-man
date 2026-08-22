import { describe, expect, it } from 'vitest';
import { formatTemplate } from './formatTemplate';

describe('formatTemplate', () => {
  it('replaces repeated placeholders', () => {
    expect(formatTemplate('{count} of {count} done', { count: 3 })).toBe('3 of 3 done');
  });

  it('replaces multiple placeholder keys', () => {
    expect(formatTemplate('{day} {slot}', { day: 'Monday', slot: '17:30' })).toBe('Monday 17:30');
  });

  it('leaves missing placeholders unchanged', () => {
    expect(formatTemplate('{known} {missing}', { known: 'value' })).toBe('value {missing}');
  });
});
