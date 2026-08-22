import { describe, expect, it } from 'vitest';
import type { Evaluation } from '../../types';
import { getFeedbackPrompt } from './generateFeedback';

const scores = {
  attendance: 94,
  effort: 90,
  pronunciation: 90,
  homework: 100,
  behavior: 100,
};

function makeEvaluation(overrides: Partial<Evaluation>): Evaluation {
  return {
    id: 'eval',
    studentId: 'student-1',
    classId: 'class-1',
    teacherId: 'teacher-1',
    evaluationType: 'final',
    scores,
    totalScore: 95,
    positivePoints: ['Luôn hoàn thành bài tập được giao.'],
    improvementPoints: 'Tuy nhiên: Cần chú ý phần grammar nhiều hơn.',
    date: '2026-06-01',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getFeedbackPrompt', () => {
  it('includes the three most recent historical evaluations and asks AI to use trends', () => {
    const history = [
      makeEvaluation({
        id: 'eval-1',
        date: '2026-06-01',
        totalScore: 92,
        positivePoints: ['Phát âm to, rõ ràng.'],
        improvementPoints: 'Tuy nhiên: Thi thoảng hay nói chuyện với bạn.',
      }),
      makeEvaluation({
        id: 'eval-2',
        date: '2026-05-01',
        evaluationType: 'midterm',
        totalScore: 86,
        positivePoints: ['Có sự cố gắng trong học tập.'],
        improvementPoints: 'Tuy nhiên: Cần chú ý sử dụng đúng các công thức đã học.',
      }),
      makeEvaluation({
        id: 'eval-3',
        date: '2026-04-01',
        totalScore: 80,
        positivePoints: ['Tham gia tốt các hoạt động trong lớp.'],
        improvementPoints: 'Tuy nhiên: Dễ quên kiến thức cũ.',
      }),
      makeEvaluation({
        id: 'eval-4',
        date: '2026-03-01',
        totalScore: 75,
        positivePoints: ['Ngoan, hòa đồng, năng động.'],
        improvementPoints: 'Tuy nhiên: Còn ít giơ tay phát biểu.',
      }),
    ];

    const prompt = getFeedbackPrompt('Lương Thị Khánh Ngọc', 1, scores, 95, history as any);
    const normalizedPrompt = prompt.toLowerCase();

    expect(prompt).toContain('Lịch sử tối đa 3 đánh giá gần nhất');
    expect(prompt).toContain('Đánh giá gần nhất #1');
    expect(prompt).toContain('Ngày: 2026-06-01');
    expect(prompt).toContain('Ngày: 2026-04-01');
    expect(prompt).not.toContain('Ngày: 2026-03-01');
    expect(normalizedPrompt).toContain('điểm cần cải thiện lặp lại');
    expect(normalizedPrompt).toContain('tiến bộ');
    expect(normalizedPrompt).toContain('không lặp nguyên văn nhận xét cũ');
  });

  it('instructs AI to keep each feedback field within 200 characters', () => {
    const prompt = getFeedbackPrompt('Lương Thị Khánh Ngọc', 1, scores, 95, null);

    expect(prompt).toContain('positivePoints');
    expect(prompt).toContain('improvementPoints');
    expect(prompt).toContain(
      'Mỗi giá trị của positivePoints và improvementPoints tối đa 200 ký tự'
    );
    expect(prompt).toContain('Không viết câu bị lửng hoặc bị cắt giữa chừng');
  });
});
