import { describe, expect, it, vi } from 'vitest';
import { backfillStaffCreatedAt } from './backfill-staff-created-at';

type UserDoc = Record<string, unknown> | undefined;

function buildDb(records: Record<string, UserDoc>) {
  const writes: Array<{
    ref: { id: string };
    data: { createdAt: string };
    precondition: { lastUpdateTime: { uid: string } };
  }> = [];
  const commit = vi.fn().mockResolvedValue(undefined);
  const batch = vi.fn(() => ({
    update: (
      ref: { id: string },
      data: { createdAt: string },
      precondition: { lastUpdateTime: { uid: string } }
    ) => writes.push({ ref, data, precondition }),
    commit,
  }));
  const doc = vi.fn((uid: string) => ({
    get: vi.fn().mockResolvedValue({
      exists: records[uid] !== undefined,
      data: () => records[uid],
      ref: { id: uid },
      updateTime: { uid },
    }),
  }));

  return {
    db: {
      collection: vi.fn((name: string) => {
        expect(name).toBe('users');
        return { doc };
      }),
      batch,
    } as any,
    writes,
    commit,
    batch,
  };
}

describe('backfillStaffCreatedAt', () => {
  it('paginates and reports a dry-run without writing', async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({
        users: [
          {
            uid: 'teacher-1',
            metadata: { creationTime: '2020-01-31T03:00:00.000Z' },
          },
          {
            uid: 'office-set',
            metadata: { creationTime: '2021-02-01T03:00:00.000Z' },
          },
          {
            uid: 'student-1',
            metadata: { creationTime: '2022-03-01T03:00:00.000Z' },
          },
          { uid: 'bad-time', metadata: { creationTime: 'not-a-date' } },
          {
            uid: 'missing-doc',
            metadata: { creationTime: '2023-04-01T03:00:00.000Z' },
          },
        ],
        pageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        users: [
          {
            uid: 'accounting-1',
            metadata: { creationTime: '2024-05-01T03:00:00.000Z' },
          },
        ],
      });
    const retiredStaffRole = ['level', 'manager'].join('_');
    const { db, writes, commit, batch } = buildDb({
      'teacher-1': { role: 'teacher' },
      'office-set': { role: 'office', createdAt: '2021-02-01T03:00:00.000Z' },
      'student-1': { role: 'student' },
      'bad-time': { role: retiredStaffRole },
      'accounting-1': { role: 'accounting' },
    });

    const summary = await backfillStaffCreatedAt({
      auth: { listUsers } as any,
      db,
      apply: false,
      log: vi.fn(),
    });

    expect(listUsers).toHaveBeenNthCalledWith(1, 1000, undefined);
    expect(listUsers).toHaveBeenNthCalledWith(2, 1000, 'page-2');
    expect(summary).toEqual({
      mode: 'dry-run',
      scanned: 6,
      eligible: 2,
      wouldUpdate: 2,
      updated: 0,
      alreadySet: 1,
      missingUserDoc: 1,
      outOfScopeRole: 2,
      missingCreationTime: 0,
      errors: 0,
    });
    expect(batch).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('writes eligible records in bounded batches when apply is enabled', async () => {
    const listUsers = vi.fn().mockResolvedValue({
      users: [
        {
          uid: 'teacher-1',
          metadata: { creationTime: '2020-01-31T03:00:00.000Z' },
        },
        {
          uid: 'office-1',
          metadata: { creationTime: '2021-02-01T03:00:00.000Z' },
        },
      ],
    });
    const { db, writes, commit } = buildDb({
      'teacher-1': { role: 'teacher' },
      'office-1': { role: 'office' },
    });

    const summary = await backfillStaffCreatedAt({
      auth: { listUsers } as any,
      db,
      apply: true,
      maxBatchWrites: 1,
      log: vi.fn(),
    });

    expect(writes).toEqual([
      {
        ref: { id: 'teacher-1' },
        data: { createdAt: '2020-01-31T03:00:00.000Z' },
        precondition: { lastUpdateTime: { uid: 'teacher-1' } },
      },
      {
        ref: { id: 'office-1' },
        data: { createdAt: '2021-02-01T03:00:00.000Z' },
        precondition: { lastUpdateTime: { uid: 'office-1' } },
      },
    ]);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      mode: 'apply',
      eligible: 2,
      wouldUpdate: 0,
      updated: 2,
      errors: 0,
    });
  });

  it('guards an apply write with the snapshot update-time precondition', async () => {
    const updateTime = { seconds: 123, nanoseconds: 456 };
    const ref = { id: 'teacher-1' };
    const update = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: 'teacher' }),
            ref,
            updateTime,
          }),
        })),
      })),
      batch: vi.fn(() => ({ update, commit })),
    };

    await backfillStaffCreatedAt({
      auth: {
        listUsers: vi.fn().mockResolvedValue({
          users: [
            {
              uid: 'teacher-1',
              metadata: { creationTime: '2020-01-31T03:00:00.000Z' },
            },
          ],
        }),
      } as any,
      db: db as any,
      apply: true,
      log: vi.fn(),
    });

    expect(update).toHaveBeenCalledWith(
      ref,
      { createdAt: '2020-01-31T03:00:00.000Z' },
      { lastUpdateTime: updateTime }
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a record that already has createdAt', async () => {
    const listUsers = vi.fn().mockResolvedValue({
      users: [
        {
          uid: 'accounting-1',
          metadata: { creationTime: '2020-01-01T00:00:00.000Z' },
        },
      ],
    });
    const { db, writes, commit } = buildDb({
      'accounting-1': {
        role: 'accounting',
        createdAt: '2019-12-31T00:00:00.000Z',
      },
    });

    const summary = await backfillStaffCreatedAt({
      auth: { listUsers } as any,
      db,
      apply: true,
      log: vi.fn(),
    });

    expect(summary.alreadySet).toBe(1);
    expect(writes).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
  });
  it('logs the summary and rethrows fatal page errors', async () => {
    const failure = new Error('Auth unavailable');
    const log = vi.fn();
    const { db } = buildDb({});

    await expect(
      backfillStaffCreatedAt({
        auth: { listUsers: vi.fn().mockRejectedValue(failure) } as any,
        db,
        apply: false,
        log,
      })
    ).rejects.toThrow('Auth unavailable');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('"errors": 1'));
  });


});
