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

import { AdminChatClassifierError, classifyAdminChatQuestion } from './adminIntentClassifier.js';

describe('adminIntentClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies headcount queries correctly', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_center_headcount',
        metrics: ['studying', 'on_leave', 'inactive'],
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Trung tâm hiện có bao nhiêu học sinh active, nghỉ và thôi học?',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_center_headcount');
    expect(result.metrics).toEqual(['studying', 'on_leave', 'inactive']);
  });

  it('classifies student lookup and student phone with entity hints', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_student_phone',
        studentHint: 'Minh',
        teacherHint: 'Lan',
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Số điện thoại Minh lớp cô Lan',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_student_phone');
    expect(result.studentHint).toBe('Minh');
    expect(result.teacherHint).toBe('Lan');
  });

  it('classifies multi-metric finance questions preserving order and valid allowlist', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_center_finance',
        period: 'current_month',
        metrics: ['net_billed', 'cash_in'],
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Doanh thu dự kiến tháng này và đã thu thực tế?',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_center_finance');
    expect(result.period).toBe('current_month');
    expect(result.metrics).toEqual(['net_billed', 'cash_in']);
  });

  it('classifies class tuition ranking with ranking criterion and clamp limit', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_class_tuition_ranking',
        ranking: 'highest_outstanding',
        limit: 25, // exceeds max 10
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Lớp nào còn nợ học phí nhiều nhất?',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_class_tuition_ranking');
    expect(result.ranking).toBe('highest_outstanding');
    expect(result.limit).toBe(10); // clamped to 10
  });

  it('classifies teacher payroll queries', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_teacher_payroll',
        teacherHint: 'Lan',
        period: 'current_month',
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Lương cô Lan tháng này bao nhiêu?',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_teacher_payroll');
    expect(result.teacherHint).toBe('Lan');
  });

  it('classifies student academic queries', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_student_academic',
        studentHint: 'Nguyễn Minh',
        classHint: 'Movers 1',
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Kết quả chi tiết của Nguyễn Minh lớp Movers 1',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_student_academic');
    expect(result.studentHint).toBe('Nguyễn Minh');
    expect(result.classHint).toBe('Movers 1');
  });

  it('classifies Zalo operations queries', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_zalo_operations',
        period: 'current_month',
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Zalo tháng này gửi thành công bao nhiêu, lỗi gì nhiều nhất?',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('admin_zalo_operations');
    expect(result.period).toBe('current_month');
  });

  it('turns unknown intent into unsupported without failing', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'arbitrary_sql_injection',
      }),
    });

    const result = await classifyAdminChatQuestion({
      text: 'Show me all databases',
      apiKey: 'test-key',
    });

    expect(result.intent).toBe('unsupported');
  });

  it('throws AdminChatClassifierError on invalid JSON', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: 'This is not json',
    });

    await expect(
      classifyAdminChatQuestion({
        text: 'Hello',
        apiKey: 'test-key',
      })
    ).rejects.toBeInstanceOf(AdminChatClassifierError);
  });

  it('does not send any session context or database data in the prompt', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'admin_student_tuition',
        studentHint: 'Minh',
      }),
    });

    await classifyAdminChatQuestion({
      text: 'Em thứ hai đóng chưa?',
      apiKey: 'test-key',
    });

    const callArgs = genaiMocks.generateContent.mock.calls[0][0];
    expect(callArgs.contents).toContain('Em thứ hai đóng chưa?');
    // Verify contents only contain the question text, no injected db fields
    expect(callArgs.contents).not.toContain('studentId');
    expect(callArgs.contents).not.toContain('teacherId');
    expect(callArgs.contents).not.toContain('classId');
  });
});
