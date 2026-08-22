import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  readZaloBotChatSession,
  writeZaloBotChatSession,
  ZALO_BOT_CHAT_SESSION_TTL_MS,
} from './chatSessionRepository.js';

describe('chatSessionRepository', () => {
  let memory: ReturnType<typeof createInMemoryDocumentStore>;
  let db: any;
  const now = '2026-08-16T10:00:00.000Z';

  beforeEach(() => {
    memory = createInMemoryDocumentStore({});
    db = memory.db;
  });

  it('returns null when there is no session', async () => {
    expect(await readZaloBotChatSession(db, 'staff_1', now)).toBeNull();
  });

  it('round-trips a session', async () => {
    await writeZaloBotChatSession(db, {
      staffId: 'staff_1',
      lastIntent: 'class_student_count',
      lastClassId: 'c_a1',
      lastClassName: '7A1',
      now,
    });

    expect(await readZaloBotChatSession(db, 'staff_1', now)).toEqual({
      lastIntent: 'class_student_count',
      lastClassId: 'c_a1',
      lastClassName: '7A1',
    });
  });

  it('ignores a session past its expiry', async () => {
    await writeZaloBotChatSession(db, {
      staffId: 'staff_1',
      lastIntent: 'class_student_count',
      lastClassId: 'c_a1',
      lastClassName: '7A1',
      now,
    });

    const later = new Date(
      Date.parse(now) + ZALO_BOT_CHAT_SESSION_TTL_MS + 1_000
    ).toISOString();

    expect(await readZaloBotChatSession(db, 'staff_1', later)).toBeNull();
  });

  it('stores no message text and no student data', async () => {
    await writeZaloBotChatSession(db, {
      staffId: 'staff_1',
      lastIntent: 'class_student_count',
      lastClassId: 'c_a1',
      lastClassName: '7A1',
      now,
    });

    const stored = memory.store.get('zalo_bot_chat_sessions/staff_1')!;
    expect(Object.keys(stored).sort()).toEqual([
      'expiresAt',
      'lastAskedAt',
      'lastClassId',
      'lastClassName',
      'lastIntent',
      'staffId',
    ]);
  });

  it('overwrites the previous session for the same staff', async () => {
    await writeZaloBotChatSession(db, {
      staffId: 'staff_1',
      lastIntent: 'class_student_count',
      lastClassId: 'c_a1',
      lastClassName: '7A1',
      now,
    });
    await writeZaloBotChatSession(db, {
      staffId: 'staff_1',
      lastIntent: 'my_todo',
      lastClassId: null,
      lastClassName: null,
      now,
    });

    expect(await readZaloBotChatSession(db, 'staff_1', now)).toEqual({
      lastIntent: 'my_todo',
      lastClassId: null,
      lastClassName: null,
    });
  });
});
