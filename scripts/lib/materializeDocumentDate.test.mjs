import { describe, expect, it } from 'vitest';
import { materializeDocumentDateOnly } from './materializeDocumentDate.mjs';

describe('materializeDocumentDateOnly', () => {
  it('keeps PostgreSQL DATE strings unchanged', () => {
    expect(materializeDocumentDateOnly('2026-08-18')).toBe('2026-08-18');
  });

  it('formats Date objects in Vietnam instead of truncating UTC', () => {
    const vietnamMidnight = new Date('2026-08-17T17:00:00.000Z');
    expect(materializeDocumentDateOnly(vietnamMidnight)).toBe('2026-08-18');
  });

  it('normalizes ISO timestamps created by an earlier materialization pass', () => {
    expect(materializeDocumentDateOnly('2026-08-17T17:00:00.000Z')).toBe('2026-08-18');
  });

  it('does not invent a year for an already truncated date', () => {
    expect(materializeDocumentDateOnly('Wed Jul 08')).toBe('Wed Jul 08');
  });
});
