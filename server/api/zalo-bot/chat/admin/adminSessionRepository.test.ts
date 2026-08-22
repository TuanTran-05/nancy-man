import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  ADMIN_SESSIONS_COLLECTION,
  ADMIN_SESSION_TTL_MS,
  clearAdminSession,
  getAdminSession,
  saveAdminSession,
} from './adminSessionRepository.js';

describe('adminSessionRepository', () => {
  it('saves and retrieves active session within TTL', async () => {
    const { db } = createInMemoryDocumentStore({
      [ADMIN_SESSIONS_COLLECTION]: {},
    });

    const now = new Date('2026-08-16T10:00:00Z');

    await saveAdminSession(
      db as any,
      {
        staffId: 'admin_1',
        lastStudentId: 'student_123',
        lastTeacherId: 'teacher_lan',
        lastClassId: 'class_movers',
        pendingCandidateIds: ['c1', 'c2'],
      },
      now
    );

    const session = await getAdminSession(db as any, 'admin_1', now);
    expect(session).toBeDefined();
    expect(session?.lastStudentId).toBe('student_123');
    expect(session?.lastTeacherId).toBe('teacher_lan');
    expect(session?.pendingCandidateIds).toEqual(['c1', 'c2']);
    expect(JSON.stringify(session)).not.toContain('Nguyễn Văn A');
  });

  it('returns null when session has expired past TTL', async () => {
    const { db } = createInMemoryDocumentStore({
      [ADMIN_SESSIONS_COLLECTION]: {},
    });

    const createdTime = new Date('2026-08-16T10:00:00Z');
    await saveAdminSession(
      db as any,
      {
        staffId: 'admin_1',
        lastStudentId: 'student_123',
      },
      createdTime
    );

    // Query at 16 minutes later (> 15m TTL)
    const queryTime = new Date(createdTime.getTime() + ADMIN_SESSION_TTL_MS + 60_000);
    const session = await getAdminSession(db as any, 'admin_1', queryTime);
    expect(session).toBeNull();
  });

  it('clears session properly', async () => {
    const { db } = createInMemoryDocumentStore({
      [ADMIN_SESSIONS_COLLECTION]: {},
    });

    const now = new Date('2026-08-16T10:00:00Z');
    await saveAdminSession(db as any, { staffId: 'admin_1', lastStudentId: 'student_1' }, now);
    await clearAdminSession(db as any, 'admin_1');

    const session = await getAdminSession(db as any, 'admin_1', now);
    expect(session).toBeNull();
  });
});
