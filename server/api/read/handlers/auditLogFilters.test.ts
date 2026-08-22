import { describe, expect, it } from 'vitest';
import { resolveAuditLogFilters } from './auditLogFilters.js';

describe('resolveAuditLogFilters', () => {
  it('preserves filters and expands the end date through the last millisecond', () => {
    expect(
      resolveAuditLogFilters({
        query: {
          actionFilter: ' update ',
          collectionFilter: ' students ',
          startDate: '2026-08-01',
          endDate: '2026-08-19',
        },
      })
    ).toEqual({
      action: 'update',
      collectionName: 'students',
      startIso: '2026-08-01T00:00:00.000Z',
      endIso: '2026-08-19T23:59:59.999Z',
    });
  });

  it('uses the same thirty-day default window as the DocumentStore reader', () => {
    const filters = resolveAuditLogFilters({ query: {} }, new Date('2026-08-19T12:00:00.000Z'));
    expect(filters.startIso).toBe('2026-07-20T00:00:00.000Z');
    expect(filters.endIso).toBe('2026-08-19T23:59:59.999Z');
  });

  it('rejects malformed, reversed, and overlong ranges with HTTP status 400', () => {
    for (const query of [
      { startDate: '19-08-2026' },
      { startDate: '2026-08-19', endDate: '2026-08-18' },
      { startDate: '2026-01-01', endDate: '2026-08-19' },
    ]) {
      try {
        resolveAuditLogFilters({ query });
        throw new Error('Expected filter validation to fail');
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 400 });
      }
    }
  });
});
