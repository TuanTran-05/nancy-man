import { beforeEach, describe, expect, it, vi } from 'vitest';

const genaiMocks = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: genaiMocks.generateContent } };
  }),
  ThinkingLevel: {
    MINIMAL: 'MINIMAL',
  },
}));

import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import { dispatchAdminChatMessage } from './adminChatDispatcher.js';
import { ADMIN_CHAT_INTENTS } from '../../../../../shared/adminChatMetrics.js';

describe('adminChatDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDeps = {
    config: {
      adminDataEnabled: true,
      adminIntentsEnabled: [...ADMIN_CHAT_INTENTS],
      adminPilotUids: [],
      adminSnapshotRefreshEnabled: true,
      adminReadAuditRetentionDays: 90,
      botToken: 'token',
      botAppId: 'app',
      botSecretKey: 'sec',
      oaId: 'oa',
      webhookSecret: 'sec',
      chatHashSecret: 'test-admin-chat-hash-secret-1234',
    } as any,
    sendText: vi.fn(),
    apiKey: 'test-key',
  };

  const mockAdminActor = {
    uid: 'admin_1',
    role: 'admin',
    isBlocked: false,
  };

  it('returns handled: false when adminDataEnabled is false', async () => {
    const { db } = createInMemoryDocumentStore({});
    const deps = {
      ...mockDeps,
      config: { ...mockDeps.config, adminDataEnabled: false },
    };

    const res = await dispatchAdminChatMessage(
      db as any,
      {
        staffId: 'admin_1',
        chatId: 'chat_1',
        text: 'Doanh thu tháng này',
        zaloMessageId: 'zm_1',
        now: '2026-08-16T10:00:00Z',
      },
      deps,
      mockAdminActor as any
    );

    expect(res.handled).toBe(false);
  });

  it('handles base greetings without DB writes', async () => {
    const { db } = createInMemoryDocumentStore({});

    const res = await dispatchAdminChatMessage(
      db as any,
      {
        staffId: 'admin_1',
        chatId: 'chat_1',
        text: 'Xin chào bot',
        zaloMessageId: 'zm_1',
        now: '2026-08-16T10:00:00Z',
      },
      mockDeps,
      mockAdminActor as any
    );

    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.text).toContain('Trợ lý Dữ liệu EduTrack');
    }
  });

  it('executes full student tuition query with audit log and session update', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_student_tuition',
        studentHint: 'Minh',
      }),
    });

    const { db } = createInMemoryDocumentStore({
      'students/s1': {
        name: 'Nguyễn Văn Minh',
        studentId: 'HV01',
        studentLifecycle: 'enrolled',
      },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-06-01',
        joinedAt: '2026-06-01',
      },
      'classes/c1': { name: 'Movers 1', teacherId: 't1' },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'course_fee_ledgers/l1': {
        id: 'l1',
        studentId: 's1',
        classId: 'c1',
        termStart: '2026-06-01',
        amount: 2_000_000,
        discountTotal: 0,
        paidTotal: 2_000_000,
        dueDate: '2026-08-10',
        termLabel: 'Khóa Hè 2026',
      },
    });

    const res = await dispatchAdminChatMessage(
      db as any,
      {
        staffId: 'admin_1',
        chatId: 'chat_1',
        text: 'Học phí của Nguyễn Văn Minh đóng chưa?',
        zaloMessageId: 'zm_1',
        now: '2026-08-16T10:00:00Z',
      },
      mockDeps,
      mockAdminActor as any
    );

    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.text).toContain('Nguyễn Văn Minh');
      expect(res.text).toContain('Đã đóng đủ (100%)');
      expect(res.text).toContain('2.000.000 đ');
    }

    // Verify session stored
    const sessionSnap = await (db as any)
      .collection('zalo_bot_admin_sessions')
      .doc('admin_1')
      .get();
    expect(sessionSnap.exists).toBe(true);
    expect(sessionSnap.data().lastStudentId).toBe('s1');

    // Verify audit log completed
    const auditQuery = await (db as any)
      .collection('audit_logs')
      .where('action', '==', 'admin_data_read')
      .get();
    expect(auditQuery.docs.length).toBe(2); // started and completed
  });

  it('records a completed audit when a student-scoped request has no hint', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'admin_student_lookup' }),
    });
    const { db } = createInMemoryDocumentStore({});

    const res = await dispatchAdminChatMessage(
      db as any,
      {
        staffId: 'admin_1',
        chatId: 'chat_1',
        text: 'Tìm học sinh',
        zaloMessageId: 'zm_empty_hint',
        now: '2026-08-16T10:00:00Z',
      },
      mockDeps,
      mockAdminActor as any
    );

    expect(res.handled).toBe(true);
    const audits = await (db as any)
      .collection('audit_logs')
      .where('action', '==', 'admin_data_read')
      .get();
    expect(audits.docs).toHaveLength(2);
    expect(audits.docs.map((doc: any) => doc.data().metadata.accessStage).sort()).toEqual([
      'completed',
      'started',
    ]);
  });

  it('passes base intents to the existing deterministic pipeline without an admin audit', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'class_student_count', classHint: '7A1' }),
    });
    const { db } = createInMemoryDocumentStore({});

    const res = await dispatchAdminChatMessage(
      db as any,
      {
        staffId: 'admin_1',
        chatId: 'chat_1',
        text: 'Sĩ số lớp 7A1',
        zaloMessageId: 'zm_base_intent',
        now: '2026-08-16T10:00:00Z',
      },
      mockDeps,
      mockAdminActor as any
    );

    expect(res).toEqual({
      handled: false,
      baseQuestion: { intent: 'class_student_count', classNameHint: '7A1' },
    });
    expect(
      await (db as any).collection('audit_logs').where('action', '==', 'admin_data_read').get()
    ).toMatchObject({ docs: [] });
  });
});
