import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import { generateCourseFeeLedgersInBatches, runCourseFeeLedgers } from './classAdminApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('generateCourseFeeLedgersInBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chunks explicit classIds so one request cannot process every class', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        createdCount: 2,
        skippedDuplicates: 0,
        skippedClasses: 0,
        processedClasses: 2,
        cursor: 'class-2',
        hasMore: false,
        batchSize: 2,
      })
      .mockResolvedValueOnce({
        success: true,
        createdCount: 1,
        skippedDuplicates: 1,
        skippedClasses: 0,
        processedClasses: 1,
        cursor: 'class-3',
        hasMore: false,
        batchSize: 2,
      });

    const result = await generateCourseFeeLedgersInBatches(['class-1', 'class-2', 'class-3'], {
      batchSize: 2,
    });

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { classIds: ['class-1', 'class-2'], batchSize: 2 },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { classIds: ['class-3'], batchSize: 2 },
    });
    expect(result).toEqual({
      success: true,
      createdCount: 3,
      skippedDuplicates: 1,
      skippedClasses: 0,
      processedClasses: 3,
      batches: 2,
    });
  });
});

describe('runCourseFeeLedgers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function page(overrides: Record<string, unknown>) {
    return {
      success: true,
      mode: 'preview',
      createdCount: 0,
      skippedDuplicates: 0,
      skippedClasses: 0,
      processedClasses: 0,
      totalAmount: 0,
      plan: [],
      duplicateLedgers: [],
      errors: [],
      cursor: null,
      hasMore: false,
      batchSize: 20,
      ...overrides,
    };
  }

  it('follows the server cursor until hasMore is false', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(
        page({ createdCount: 2, totalAmount: 1_800_000, cursor: 'class-20', hasMore: true })
      )
      .mockResolvedValueOnce(
        page({ createdCount: 1, skippedDuplicates: 3, totalAmount: 900_000, cursor: 'class-25' })
      );

    const run = await runCourseFeeLedgers('preview');

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { mode: 'preview', batchSize: 20 },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/classes/generate-ledgers', {
      method: 'POST',
      body: { mode: 'preview', batchSize: 20, cursor: 'class-20' },
    });
    expect(run.createdCount).toBe(3);
    expect(run.totalAmount).toBe(2_700_000);
    expect(run.pages).toBe(2);
  });

  it('throws when the cursor stops advancing instead of looping', async () => {
    vi.mocked(apiRequest).mockResolvedValue(
      page({ createdCount: 1, cursor: 'stuck', hasMore: true })
    );

    await expect(runCourseFeeLedgers('preview')).rejects.toThrow(/cursor/i);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('throws when the server answers in a different mode', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(page({ mode: 'apply' }));

    await expect(runCourseFeeLedgers('preview')).rejects.toThrow(/mode/i);
  });

  it('stops when the server reports more pages but returns no cursor', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(page({ hasMore: true, cursor: null }));

    const run = await runCourseFeeLedgers('preview');

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(run.pages).toBe(1);
  });
});
