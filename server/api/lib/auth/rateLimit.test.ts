import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit, isDuplicateWithinWindow, markRecord } from './rateLimit';

// Mock DocumentStore
function createMockDb(existingData?: { count: number; windowStart: number }) {
  const mockDoc = {
    exists: !!existingData,
    data: () => existingData || {},
  };

  const mockGet = vi.fn().mockResolvedValue(mockDoc);
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockUpdate = vi.fn().mockResolvedValue(undefined);
  const mockTx = {
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
  };

  const mockDocRef = {
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
  };

  const mockCollection = {
    doc: vi.fn().mockReturnValue(mockDocRef),
  };

  const mockDb = {
    collection: vi.fn().mockReturnValue(mockCollection),
    runTransaction: vi.fn(async (callback: any) => callback(mockTx)),
  };

  return { mockDb, mockDocRef, mockGet, mockSet, mockUpdate };
}

describe('checkRateLimit', () => {
  it('should allow first request and create document', async () => {
    const { mockDb, mockDocRef, mockSet } = createMockDb();
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(mockSet).toHaveBeenCalledWith(mockDocRef, expect.objectContaining({ count: 1 }));
  });

  it('should allow subsequent requests within window', async () => {
    const { mockDb, mockDocRef, mockUpdate } = createMockDb({
      count: 2,
      windowStart: Date.now(),
    });
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ count: expect.any(Object) })
    );
  });

  it('should deny when max attempts reached', async () => {
    const { mockDb } = createMockDb({
      count: 5,
      windowStart: Date.now(),
    });
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should reset when window expired', async () => {
    const { mockDb, mockSet } = createMockDb({
      count: 5,
      windowStart: Date.now() - 120000, // 2 minutes ago, window is 1 minute
    });
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(mockSet).toHaveBeenCalled();
  });

  it('should fail closed on DocumentStore error by default', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockRejectedValue(new Error('DocumentStore error')),
        }),
      }),
    };
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should fail open on DocumentStore error when failOpen is true', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockRejectedValue(new Error('DocumentStore error')),
        }),
      }),
    };
    const result = await checkRateLimit(mockDb as any, 'test-key', 5, 60000, { failOpen: true });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});

describe('isDuplicateWithinWindow', () => {
  it('should return true when record exists within window', async () => {
    const { mockDb } = createMockDb({
      count: 1,
      windowStart: Date.now(),
    });
    const result = await isDuplicateWithinWindow(mockDb as any, 'test-key', 86400000);
    expect(result).toBe(true);
  });

  it('should return false when record does not exist', async () => {
    const { mockDb } = createMockDb(); // exists: false
    const result = await isDuplicateWithinWindow(mockDb as any, 'test-key', 86400000);
    expect(result).toBe(false);
  });

  it('should return false when record is expired', async () => {
    const { mockDb } = createMockDb({
      count: 1,
      windowStart: Date.now() - 100000, // 100 seconds ago, window is 60 seconds
    });
    const result = await isDuplicateWithinWindow(mockDb as any, 'test-key', 60000);
    expect(result).toBe(false);
  });

  it('should return false on DocumentStore error', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockRejectedValue(new Error('DocumentStore error')),
        }),
      }),
    };
    const result = await isDuplicateWithinWindow(mockDb as any, 'test-key', 86400000);
    expect(result).toBe(false);
  });
});

describe('markRecord', () => {
  it('should create/overwrite document', async () => {
    const { mockDb, mockSet } = createMockDb();
    await markRecord(mockDb as any, 'test-key', 86400000);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        windowStart: expect.any(Number),
        updatedAt: expect.any(Number),
      })
    );
  });

  it('should not throw on DocumentStore error', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: vi.fn().mockRejectedValue(new Error('DocumentStore error')),
        }),
      }),
    };
    await expect(markRecord(mockDb as any, 'test-key', 86400000)).resolves.toBeUndefined();
  });
});
