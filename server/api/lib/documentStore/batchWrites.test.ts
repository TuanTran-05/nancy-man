import { describe, expect, it, vi } from 'vitest';
import { deleteRefsInChunks } from './batchWrites.js';

describe('deleteRefsInChunks', () => {
  it('commits deletes in DocumentStore-safe chunks', async () => {
    const commits: number[] = [];
    const batches: Array<{ delete: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> }> =
      [];
    const db = {
      batch: vi.fn(() => {
        let count = 0;
        const batch = {
          delete: vi.fn(() => {
            count += 1;
          }),
          commit: vi.fn(async () => {
            commits.push(count);
          }),
        };
        batches.push(batch);
        return batch;
      }),
    };
    const refs = Array.from({ length: 1_001 }, (_, index) => ({ path: `docs/${index}` }));

    const deleted = await deleteRefsInChunks(db as any, refs as any, 450);

    expect(deleted).toBe(1_001);
    expect(db.batch).toHaveBeenCalledTimes(3);
    expect(commits).toEqual([450, 450, 101]);
    expect(batches.every((batch) => batch.delete.mock.calls.length <= 450)).toBe(true);
  });

  it('does not create a batch for an empty delete set', async () => {
    const db = { batch: vi.fn() };

    const deleted = await deleteRefsInChunks(db as any, []);

    expect(deleted).toBe(0);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
