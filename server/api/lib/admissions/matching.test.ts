import { describe, expect, it, vi } from 'vitest';
import { findAdmissionMatches } from './matching.js';

function studentDoc(id: string, data: Record<string, unknown>) {
  return { id, ref: { id }, data: () => data };
}

describe('findAdmissionMatches', () => {
  it('returns an archived possible match when normalized name and phone match but DOB differs', async () => {
    const candidate = studentDoc('archived-student', {
      name: 'Nguyen Van A',
      admissionSearchName: 'nguyen van a',
      admissionSearchDob: '2014-02-02',
      admissionSearchContact: '0384072314',
      studentLifecycle: 'archived',
    });
    const db: any = {
      collection: vi.fn(() => ({
        where: vi.fn((field: string) => ({
          limit: vi.fn(function (this: any) {
            return this;
          }),
          get: vi.fn().mockResolvedValue({
            docs:
              field === 'admissionSearchName' || field === 'admissionSearchContact'
                ? [candidate]
                : [],
          }),
        })),
      })),
    };

    const result = await findAdmissionMatches(db, {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '+84384072314',
    });

    expect(result.possibleMatches.map((match) => match.id)).toEqual(['archived-student']);
    expect(result.possibleMatches[0]?.reasons).toEqual(['name', 'contact']);
  });

  it('normalizes a previously stored noncanonical search phone before exact comparison', async () => {
    const candidate = studentDoc('active-student', {
      name: 'Nguyen Van A',
      admissionSearchName: 'nguyen van a',
      admissionSearchDob: '2014-01-01',
      admissionSearchContact: '0384072314',
      studentLifecycle: 'enrolled',
    });
    const db: any = {
      collection: vi.fn(() => ({
        where: vi.fn((field: string) => ({
          limit: vi.fn(function (this: any) {
            return this;
          }),
          get: vi.fn().mockResolvedValue({ docs: field === 'dob' ? [candidate] : [] }),
        })),
      })),
    };

    const result = await findAdmissionMatches(db, {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '+84384072314',
    });

    expect(result.currentExactMatches.map((match) => match.id)).toEqual(['active-student']);
  });

  it('limits every duplicate lookup query to ten candidates', async () => {
    const queries: Array<{ field: string; value: unknown; limit: ReturnType<typeof vi.fn> }> = [];
    const db: any = {
      collection: vi.fn(() => ({
        where: vi.fn((field: string, _op: string, value: unknown) => {
          const query: any = {
            field,
            value,
            limit: vi.fn(() => query),
            get: vi.fn().mockResolvedValue({ docs: [] }),
          };
          queries.push(query);
          return query;
        }),
      })),
    };

    await findAdmissionMatches(db, {
      name: 'Nguyen Van A',
      dob: '2014-01-01',
      contact: '+84384072314',
    });

    expect(queries).toHaveLength(8);
    expect(queries.every((query) => query.limit.mock.calls[0]?.[0] === 10)).toBe(true);
  });
});
