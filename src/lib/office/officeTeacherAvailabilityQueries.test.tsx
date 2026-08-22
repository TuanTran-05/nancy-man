import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../api/readApi';
import {
  teacherAvailabilityPendingQueryOptions,
  teacherAvailabilityProfilesQueryOptions,
} from './officeTeacherAvailabilityQueries';

vi.mock('../api/readApi', () => ({ readChannel: vi.fn() }));

const identity = { uid: 'office-1', role: 'office' };

describe('office teacher availability queries', () => {
  beforeEach(() => vi.mocked(readChannel).mockReset());

  it('uses independent PostgreSQL views for profiles and pending requests', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({ profiles: [{ id: 'profile-1' }] } as any)
      .mockResolvedValueOnce({ requests: [{ id: 'request-1' }] } as any);
    const profiles = teacherAvailabilityProfilesQueryOptions(identity);
    const requests = teacherAvailabilityPendingQueryOptions(identity);

    await expect(profiles.queryFn!({} as any)).resolves.toEqual([{ id: 'profile-1' }]);
    await expect(requests.queryFn!({} as any)).resolves.toEqual([{ id: 'request-1' }]);
    expect(readChannel).toHaveBeenNthCalledWith(1, 'teacher-availability', {
      view: 'profiles',
      limit: expect.any(Number),
    });
    expect(readChannel).toHaveBeenNthCalledWith(2, 'teacher-availability', {
      view: 'pending',
      limit: expect.any(Number),
    });
    expect(profiles.queryKey).not.toEqual(requests.queryKey);
  });

  it('isolates cache keys by identity', () => {
    expect(teacherAvailabilityProfilesQueryOptions(identity).queryKey).not.toEqual(
      teacherAvailabilityProfilesQueryOptions({ uid: 'admin-1', role: 'admin' }).queryKey
    );
  });
});
