import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getPostgresPool: () => database,
}));

import {
  loadSession,
  publicSessionUser,
  resolveGoogleUserAccess,
  verifyStaffPasswordAccess,
} from './sessionStore.js';

const CORRECT_PASSWORD_HASH =
  '75c45cdaeb2e3fe64735e3e1facb8d2ed508f39840a267a579bb44cddbc415f6';

function requestWithSession() {
  return {
    headers: { authorization: 'Bearer session-token' },
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

describe('native session application-profile bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the application profile id and restores teacher profile fields', async () => {
    database.query
      .mockResolvedValueOnce({
        rows: [
          {
            auth_user_id: 'native-teacher-1',
            user_id: 'teacher-profile-1',
            email: 'teacher@example.com',
            display_name: 'Teacher One',
            bio: 'English teacher',
            phone: '84384072314',
            face_image: 'https://example.com/teacher.png',
            role: 'teacher',
            student_id: null,
            class_id: null,
            teacher_id: 'GV260001',
            force_password_change: false,
            user_revoked: false,
            staff_status: 'allowed',
            student_lifecycle: null,
            student_revoked: null,
            provider: 'password',
            google_linked: false,
            created_at: new Date('2026-08-20T00:00:00.000Z'),
            expires_at: new Date('2026-08-27T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const principal = await loadSession(requestWithSession());

    expect(database.query.mock.calls[0]?.[0]).toContain('left join lateral');
    expect(principal).toMatchObject({
      authUid: 'native-teacher-1',
      uid: 'teacher-profile-1',
      role: 'teacher',
      phone: '84384072314',
      bio: 'English teacher',
      teacherId: 'GV260001',
    });
    expect(publicSessionUser(principal!)).toMatchObject({
      uid: 'teacher-profile-1',
      phone: '84384072314',
      bio: 'English teacher',
      faceImage: 'https://example.com/teacher.png',
    });
  });
});

describe('staff sign-in access decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distinguishes an unknown Google email from a revoked staff account', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'teacher-1', status: 'blocked', is_revoked: false }],
      });

    await expect(resolveGoogleUserAccess('unknown@example.com', 'google-unknown')).resolves.toEqual({
      allowed: false,
      reason: 'not_allowed',
    });
    await expect(resolveGoogleUserAccess('teacher@example.com', 'google-teacher')).resolves.toEqual({
      allowed: false,
      reason: 'revoked',
    });
  });

  it('allows an active Google staff account', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{ id: 'teacher-1', status: 'allowed', is_revoked: false }],
    });

    await expect(resolveGoogleUserAccess('teacher@example.com', 'google-teacher')).resolves.toEqual({
      allowed: true,
      userId: 'teacher-1',
    });
  });

  it('only reveals the revoked password-login reason after the password is verified', async () => {
    const blockedCredential = {
      user_id: 'teacher-1',
      password_hash: CORRECT_PASSWORD_HASH,
      password_salt: 'fixed-salt',
      password_version: 2,
      status: 'blocked',
      is_revoked: false,
    };
    database.query
      .mockResolvedValueOnce({ rows: [blockedCredential] })
      .mockResolvedValueOnce({ rows: [blockedCredential] });

    await expect(
      verifyStaffPasswordAccess('teacher@example.com', 'correct-password')
    ).resolves.toEqual({ authenticated: false, reason: 'revoked' });
    await expect(
      verifyStaffPasswordAccess('teacher@example.com', 'wrong-password')
    ).resolves.toEqual({ authenticated: false, reason: 'invalid_credentials' });
  });
});
