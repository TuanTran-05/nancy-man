// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import { useLiveCollection } from '../lib/realtime/legacyLiveQuery';
import { useParentTuitionData } from './useParentTuitionData';

vi.mock('../lib/auth/sessionAuth', () => ({
  db: {},
}));

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  doc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
}));

vi.mock('../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../lib/realtime/legacyLiveQuery', () => ({
  useLiveCollection: vi.fn(() => ({ data: [], loading: false, error: null })),
}));

describe('useParentTuitionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads tuition through the read API instead of live DocumentStore listeners', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      ledgers: [{ id: 'ledger-1', studentId: 'student-1' }],
      receipts: [
        { id: 'receipt-1', studentId: 'student-1', status: 'posted' },
        { id: 'receipt-2', studentId: 'student-1', status: 'draft' },
      ],
    });

    const { result } = renderHook(() =>
      useParentTuitionData({
        uid: 'parent-1',
        role: 'parent',
        studentId: 'student-1',
      } as any)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(readChannel).toHaveBeenCalledWith('parent-tuition');
    expect(useLiveCollection).not.toHaveBeenCalled();
    expect(result.current.feeLedgers).toEqual([{ id: 'ledger-1', studentId: 'student-1' }]);
    expect(result.current.feeReceipts).toEqual([
      { id: 'receipt-1', studentId: 'student-1', status: 'posted' },
    ]);
  });
});
