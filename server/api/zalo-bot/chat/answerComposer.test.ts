import { describe, it, expect } from 'vitest';
import { composeZaloBotChatAnswer, ZALO_BOT_CHAT_MAX_TEXT } from './answerComposer.js';
import type { ZaloBotChatAnswer } from './chatTypes.js';

describe('composeZaloBotChatAnswer', () => {
  it('states the active count and breaks out the rest', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'student_count',
      className: '7A1',
      active: 18,
      onLeave: 2,
      trial: 1,
    });
    expect(text).toContain('7A1');
    expect(text).toContain('18 học sinh đang học');
    expect(text).toContain('2 bảo lưu');
    expect(text).toContain('1 học thử');
  });

  it('omits the breakdown when there is nothing to break out', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'student_count',
      className: '7A1',
      active: 18,
      onLeave: 0,
      trial: 0,
    });
    expect(text).toContain('18 học sinh đang học');
    expect(text).not.toContain('bảo lưu');
    expect(text).not.toContain('học thử');
  });

  it('numbers the student list and reports how many were cut', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'student_list',
      className: '7A1',
      names: ['NGUYỄN VĂN A', 'TRẦN THỊ B'],
      omitted: 3,
    });
    expect(text).toContain('1. NGUYỄN VĂN A');
    expect(text).toContain('2. TRẦN THỊ B');
    expect(text).toContain('5 học sinh');
    expect(text).toContain('còn 3 em nữa');
  });

  it('formats a class end date with the full year', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'class_end_date',
      className: 'Movers - Mr. Anh Tuan T7-CN 17H30',
      endDate: '2026-12-31',
    });

    expect(text).toContain('Movers - Mr. Anh Tuan T7-CN 17H30');
    expect(text).toContain('dự kiến kết khóa ngày 31/12/2026');
  });

  it('states when a class does not have an end date yet', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'class_end_date',
      className: 'Movers',
      endDate: null,
    });

    expect(text).toContain('hiện chưa có ngày kết khóa');
  });

  it('reports a class with nothing missing as done', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'attendance_today',
      date: '2026-08-16',
      classes: [{ className: '7A1', eligible: 20, marked: 20, missing: 0 }],
    });
    expect(text).toContain('7A1');
    expect(text).toContain('đã điểm danh đủ');
  });

  it('reports how many are still unmarked', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'attendance_today',
      date: '2026-08-16',
      classes: [{ className: '7A1', eligible: 20, marked: 17, missing: 3 }],
    });
    expect(text).toContain('còn 3 em chưa điểm danh');
  });

  it('says so when there is no class today', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'attendance_today',
      date: '2026-08-16',
      classes: [],
    });
    expect(text).toContain('Hôm nay bạn không có lớp nào cần điểm danh');
  });

  it('lists attendance, course-closing, and print work', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'my_todo',
      attendance: [{ className: '7A1', missingStudentCount: 3 }],
      courseClosing: [{ className: '8B2', endDate: '2026-08-20' }],
      printRequests: [
        {
          className: '6C1',
          teacherName: 'Cô Lan',
          neededDate: '2026-08-18',
          fileCount: 2,
          totalCopies: 40,
        },
      ],
    });
    expect(text).toContain('7A1');
    expect(text).toContain('8B2');
    expect(text).toContain('20/08');
    expect(text).toContain('6C1');
    expect(text).toContain('40 bản');
  });

  it('congratulates an empty todo list', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'my_todo',
      attendance: [],
      courseClosing: [],
      printRequests: [],
    });
    expect(text).toContain('Bạn không còn việc nào cần xử lý');
  });

  it('quotes the hint back without revealing whether the class exists', () => {
    const text = composeZaloBotChatAnswer({ kind: 'class_not_found', hint: '7B' });
    expect(text).toContain('7B');
    expect(text).toContain('trong các lớp của bạn');
    expect(text).not.toContain('quyền');
  });

  it('asks which class when several match', () => {
    const text = composeZaloBotChatAnswer({
      kind: 'class_ambiguous',
      candidates: ['7A1', '7A2'],
    });
    expect(text).toContain('7A1');
    expect(text).toContain('7A2');
  });

  it('lists what it can do for an unsupported question', () => {
    const text = composeZaloBotChatAnswer({ kind: 'unsupported' });
    expect(text).toContain('sĩ số');
    expect(text).toContain('ngày kết khóa');
    expect(text).toContain('điểm danh');
    expect(text).toContain('việc cần xử lý');
  });

  it('has copy for rate limiting and internal errors', () => {
    expect(composeZaloBotChatAnswer({ kind: 'rate_limited' })).toContain('thử lại sau');
    expect(composeZaloBotChatAnswer({ kind: 'error' })).toContain('chưa trả lời được');
  });

  it('never exceeds the Zalo text limit', () => {
    const answer: ZaloBotChatAnswer = {
      kind: 'student_list',
      className: 'LỚP CÓ TÊN RẤT DÀI ĐỂ THỬ GIỚI HẠN',
      names: Array.from({ length: 400 }, (_, i) => `HỌC SINH SỐ ${i} NGUYỄN VĂN DÀI`),
      omitted: 0,
    };
    expect(composeZaloBotChatAnswer(answer).length).toBeLessThanOrEqual(ZALO_BOT_CHAT_MAX_TEXT);
  });
});
