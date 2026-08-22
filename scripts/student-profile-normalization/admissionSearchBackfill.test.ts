import { describe, expect, it } from 'vitest';
import { planAdmissionSearchBackfill } from './admissionSearchBackfill.js';

type Student = { id: string; data: Record<string, unknown> };

const complete = {
  name: 'Quách Hoàng Minh',
  dob: '2014-05-02',
  contact: '0900000000',
};

function planOf(students: Student[]) {
  const plan = planAdmissionSearchBackfill(students);
  return { plan, byId: new Map(plan.rows.map((row) => [row.profileId, row])) };
}

describe('admission search backfill planning', () => {
  it('leaves a document whose derived fields already match untouched', () => {
    const { byId } = planOf([
      {
        id: 's-1',
        data: {
          ...complete,
          admissionSearchName: 'quach hoang minh',
          admissionSearchDob: '2014-05-02',
          admissionSearchContact: '84900000000',
        },
      },
    ]);

    expect(byId.get('s-1')?.state).toBe('already_complete');
    expect(byId.get('s-1')?.patch).toEqual({});
  });

  it('derives every missing field for a cloned profile that never received them', () => {
    const { byId } = planOf([{ id: 'cloned', data: { ...complete } }]);

    const row = byId.get('cloned');
    expect(row?.state).toBe('missing_fields');
    expect(row?.missingFields).toEqual([
      'admissionSearchContact',
      'admissionSearchDob',
      'admissionSearchName',
    ]);
    expect(row?.patch).toEqual({
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
    });
  });

  it('separates a stale denormalized field from a missing one', () => {
    const { byId } = planOf([
      {
        id: 'stale',
        data: {
          ...complete,
          contact: '0911111111',
          admissionSearchName: 'quach hoang minh',
          admissionSearchDob: '2014-05-02',
          admissionSearchContact: '84900000000',
        },
      },
    ]);

    const row = byId.get('stale');
    expect(row?.state).toBe('drifted');
    expect(row?.driftedFields).toEqual(['admissionSearchContact']);
    expect(row?.patch).toEqual({ admissionSearchContact: '84911111111' });
  });

  it('classifies a profile whose source identity is incomplete instead of pretending it is backfillable', () => {
    const { plan, byId } = planOf([
      { id: 'no-dob', data: { name: 'A B', contact: '0900000000' } },
      { id: 'no-contact', data: { name: 'A B', dob: '2014-05-02' } },
      { id: 'empty-name', data: { name: '   ', dob: '2014-05-02', contact: '0900000000' } },
    ]);

    expect(byId.get('no-dob')?.state).toBe('incomplete_source');
    expect(byId.get('no-dob')?.incompleteSourceFields).toEqual(['dob']);
    expect(byId.get('no-contact')?.incompleteSourceFields).toEqual(['contact']);
    expect(byId.get('empty-name')?.incompleteSourceFields).toEqual(['name']);
    expect(plan.counts.incomplete_source).toBe(3);
    expect(plan.counts.missing_fields).toBe(0);
  });

  it('skips tombstones and legacy soft merges so retired documents are not rewritten', () => {
    const { plan, byId } = planOf([
      { id: 'tombstone', data: { ...complete, studentProfileState: 'merged_tombstone' } },
      { id: 'soft-merged', data: { ...complete, mergedIntoStudentId: 'canonical-1' } },
      { id: 'live', data: { ...complete } },
    ]);

    expect(byId.get('tombstone')?.state).toBe('skipped_retired');
    expect(byId.get('soft-merged')?.state).toBe('skipped_retired');
    expect(byId.get('live')?.state).toBe('missing_fields');
    expect(plan.counts.skipped_retired).toBe(2);
  });

  it('is idempotent: applying the patch makes the same document already_complete', () => {
    const source: Student = { id: 's-1', data: { ...complete } };
    const first = planAdmissionSearchBackfill([source]);

    const applied: Student = { id: 's-1', data: { ...source.data, ...first.rows[0].patch } };
    const second = planAdmissionSearchBackfill([applied]);

    expect(second.rows[0].state).toBe('already_complete');
    expect(second.rows[0].patch).toEqual({});
    expect(second.counts.missing_fields).toBe(0);
  });

  it('reports the residual coverage gap the creation guard must treat as a known exclusion', () => {
    const { plan } = planOf([
      { id: 'ok', data: { ...complete } },
      { id: 'no-dob', data: { name: 'A B', contact: '0900000000' } },
    ]);

    expect(plan.scanned).toBe(2);
    expect(plan.backfillableProfileIds).toEqual(['ok']);
    expect(plan.residualCoverageGapProfileIds).toEqual(['no-dob']);
  });
});
