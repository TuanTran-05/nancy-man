import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../api/readApi';
import { officePrintRequestsQueryOptions } from './officePrintRequestQueries';

vi.mock('../api/readApi', () => ({ readChannel: vi.fn() }));

const identity = { uid: 'office-1', role: 'office' };

describe('officePrintRequestsQueryOptions', () => {
  beforeEach(() => vi.mocked(readChannel).mockReset());

  it('reads filtered requests through the PostgreSQL read API', async () => {
    vi.mocked(readChannel).mockResolvedValue({ requests: [{ id: 'request-1' }] } as any);
    const options = officePrintRequestsQueryOptions(identity, {
      createdDate: '2026-08-19',
      neededDate: '2026-08-20',
      status: 'pending',
    });

    await expect(options.queryFn!({} as any)).resolves.toEqual([{ id: 'request-1' }]);
    expect(readChannel).toHaveBeenCalledWith('print-requests', {
      createdDate: '2026-08-19',
      neededDate: '2026-08-20',
      status: 'pending',
      limit: expect.any(Number),
    });
  });

  it('keeps account identity in the cache key', () => {
    const office = officePrintRequestsQueryOptions(identity).queryKey;
    const admin = officePrintRequestsQueryOptions({ uid: 'admin-1', role: 'admin' }).queryKey;
    expect(office).not.toEqual(admin);
  });
});
