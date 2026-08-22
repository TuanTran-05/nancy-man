import { describe, expect, it } from 'vitest';
import {
  FINAL_AUDIT_EXPORT_MAX_AGE_MS,
  verifyManagedExportEvidence,
} from './managedExportEvidence.js';

const NOW = new Date('2026-08-07T02:00:00.000Z');

function operation(overrides: Record<string, unknown> = {}) {
  // Metadata is pulled out of the spread deliberately: leaving it in would let
  // the outer spread clobber the merged object with the raw partial.
  const { metadata, ...rest } = overrides;
  return {
    name: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
    done: true,
    ...rest,
    metadata: {
      operationState: 'SUCCESSFUL',
      outputUriPrefix: 'gs://edutrack-backups/2026-08-07T01-00-00',
      startTime: '2026-08-07T01:00:00.000Z',
      endTime: '2026-08-07T01:12:00.000Z',
      snapshotTime: '2026-08-07T01:00:00.000Z',
      ...(metadata as Record<string, unknown> | undefined),
    },
  };
}

const EXPECTED = {
  projectId: 'edutrack-prod',
  databaseId: 'edutrack',
  outputUriPrefix: 'gs://edutrack-backups/2026-08-07T01-00-00',
};

function verify(overrides: Record<string, unknown> = {}) {
  return verifyManagedExportEvidence({
    operation: operation(),
    expected: EXPECTED,
    now: NOW,
    ...overrides,
  } as Parameters<typeof verifyManagedExportEvidence>[0]);
}

describe('managed export evidence', () => {
  it('accepts a successful, recent export of the expected target', () => {
    const evidence = verify();

    expect(evidence).toMatchObject({
      operationName: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
      projectId: 'edutrack-prod',
      databaseId: 'edutrack',
      outputUriPrefix: EXPECTED.outputUriPrefix,
      snapshotTime: '2026-08-07T01:00:00.000Z',
    });
    expect(evidence.evidenceDigest).toHaveLength(64);
  });

  it('reads the project and database from the operation name, not from the caller', () => {
    // The caller's flags are what we are checking, so they cannot also be the
    // source of truth. Only the operation resource name is authoritative.
    expect(() =>
      verify({
        operation: operation({
          name: 'projects/edutrack-staging/databases/edutrack/operations/op-1',
        }),
      })
    ).toThrow('STUDENT_PROFILE_EXPORT_TARGET_MISMATCH');
  });

  it('rejects an export of a different database in the right project', () => {
    expect(() =>
      verify({
        operation: operation({
          name: 'projects/edutrack-prod/databases/other-db/operations/op-1',
        }),
      })
    ).toThrow('STUDENT_PROFILE_EXPORT_TARGET_MISMATCH');
  });

  it('rejects an operation that has not finished', () => {
    expect(() => verify({ operation: operation({ done: false }) })).toThrow(
      'STUDENT_PROFILE_EXPORT_NOT_SUCCESSFUL'
    );
  });

  it('rejects a finished operation whose state is not successful', () => {
    expect(() =>
      verify({ operation: operation({ metadata: { operationState: 'CANCELLED' } }) })
    ).toThrow('STUDENT_PROFILE_EXPORT_NOT_SUCCESSFUL');
  });

  it('rejects an operation carrying an error even when marked done', () => {
    expect(() =>
      verify({ operation: operation({ error: { code: 2, message: 'failed' } }) })
    ).toThrow('STUDENT_PROFILE_EXPORT_NOT_SUCCESSFUL');
  });

  it('rejects an output URI that is not the one under review', () => {
    expect(() =>
      verify({
        operation: operation({ metadata: { outputUriPrefix: 'gs://somewhere-else/x' } }),
      })
    ).toThrow('STUDENT_PROFILE_EXPORT_URI_MISMATCH');
  });

  it('rejects an export older than the final-audit window', () => {
    const stale = new Date(NOW.getTime() + FINAL_AUDIT_EXPORT_MAX_AGE_MS + 60_000);

    expect(() => verify({ now: stale })).toThrow('STUDENT_PROFILE_EXPORT_STALE');
  });

  it('accepts an export exactly at the window boundary', () => {
    const boundary = new Date(
      Date.parse('2026-08-07T01:00:00.000Z') + FINAL_AUDIT_EXPORT_MAX_AGE_MS
    );

    expect(() => verify({ now: boundary })).not.toThrow();
  });

  it('rejects a source document written after the snapshot was taken', () => {
    // The export is the rollback floor. A document changed after the snapshot
    // is not covered by it, so restoring would silently lose that write.
    expect(() =>
      verify({ latestObservedSourceUpdateTime: '2026-08-07T01:30:00.000Z' })
    ).toThrow('STUDENT_PROFILE_EXPORT_PRECEDES_SOURCE_WRITE');
  });

  it('accepts a source document written before the snapshot', () => {
    expect(() =>
      verify({ latestObservedSourceUpdateTime: '2026-08-07T00:59:00.000Z' })
    ).not.toThrow();
  });

  it('rejects an operation missing its snapshot time rather than assuming the start time', () => {
    expect(() =>
      verify({ operation: operation({ metadata: { snapshotTime: undefined } }) })
    ).toThrow('STUDENT_PROFILE_EXPORT_METADATA_INCOMPLETE');
  });

  it('produces a stable digest for identical evidence and a different one otherwise', () => {
    const first = verify();
    const second = verify();
    const other = verify({
      operation: operation({
        name: 'projects/edutrack-prod/databases/edutrack/operations/op-2',
      }),
    });

    expect(first.evidenceDigest).toBe(second.evidenceDigest);
    expect(first.evidenceDigest).not.toBe(other.evidenceDigest);
  });
});
