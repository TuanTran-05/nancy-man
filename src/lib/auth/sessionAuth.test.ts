import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from './sessionAuth';

describe('session auth profile fields', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps application profile identity and teacher contact fields from the session response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          user: {
            uid: 'teacher-profile-1',
            email: 'teacher@example.com',
            displayName: 'Teacher One',
            bio: 'English teacher',
            phone: '84384072314',
            faceImage: 'https://example.com/teacher.png',
            role: 'teacher',
            teacherId: 'GV260001',
            emailVerified: true,
            isAnonymous: false,
            tenantId: null,
            providerData: [],
          },
        }),
      })
    );

    await expect(auth.refresh()).resolves.toMatchObject({
      uid: 'teacher-profile-1',
      phone: '84384072314',
      bio: 'English teacher',
      faceImage: 'https://example.com/teacher.png',
      teacherId: 'GV260001',
    });
  });
});
