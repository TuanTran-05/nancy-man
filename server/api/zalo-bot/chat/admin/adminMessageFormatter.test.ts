import { describe, expect, it } from 'vitest';
import { ZALO_BOT_SENSITIVE_CONTENT_MARKER } from '../../../../../shared/zaloBot.js';
import {
  formatAdminQueryResult,
  formatDisambiguationMessage,
  formatNotFoundMessage,
  formatPercent,
  formatPlacementStatus,
  formatTuitionStatus,
  formatVND,
} from './adminMessageFormatter.js';

describe('adminMessageFormatter', () => {
  it('formats currency and percentages properly in Vietnamese', () => {
    expect(formatVND(1_500_000)).toBe('1.500.000 đ');
    expect(formatVND(null)).toBe('Chưa có dữ liệu');
    expect(formatPercent(0.925)).toBe('92.5%');
    expect(formatPlacementStatus('studying')).toBe('Đang học');
    expect(formatTuitionStatus('paid')).toBe('Đã đóng đủ (100%)');
  });

  it('formats student tuition query result with sensitive flag and suggestions', () => {
    const res = formatAdminQueryResult({
      kind: 'student_tuition',
      student: {
        id: 's1',
        fullName: 'Nguyễn Văn Minh',
        studentCode: 'HV01',
        className: 'Movers 1',
      },
      courseLabel: 'Khóa Hè 2026',
      paymentStatus: 'paid',
      grossBilled: 2_000_000,
      discountTotal: 0,
      netBilled: 2_000_000,
      paidTotal: 2_000_000,
      outstandingTotal: 0,
      dueDate: '2026-08-10',
      quality: { status: 'complete', issues: [] },
      computedAt: '2026-08-16T10:00:00Z',
      source: 'canonical_student_ledgers_v1',
    });

    expect(res.text).toContain('Nguyễn Văn Minh');
    expect(res.text).toContain('Đã đóng đủ (100%)');
    expect(res.text).toContain('2.000.000 đ');
    expect(res.isSensitive).toBe(true);
    expect(res.suggestedPrompts.length).toBeGreaterThanOrEqual(2);
  });

  it('formats phone number with sensitive marker when isSensitiveViewer is false', () => {
    const res = formatAdminQueryResult(
      {
        kind: 'student_phone',
        student: {
          id: 's1',
          fullName: 'Nguyễn Văn Minh',
          studentCode: 'HV01',
          className: 'Movers 1',
          phone: '0912345678',
        },
        quality: { status: 'complete', issues: [] },
        computedAt: '2026-08-16T10:00:00Z',
        source: 'canonical_students_contact_v1',
      },
      { isSensitiveViewer: false }
    );

    expect(res.text).toContain(ZALO_BOT_SENSITIVE_CONTENT_MARKER);
    expect(res.text).toContain('091****678');
  });

  it('formats disambiguation list with numbered candidates', () => {
    const res = formatDisambiguationMessage(
      [
        { id: 's1', fullName: 'Minh A', code: 'HV01', className: 'Lớp 1' },
        { id: 's2', fullName: 'Minh B', code: 'HV02', className: 'Lớp 2' },
      ],
      1
    );

    expect(res.text).toContain('Tìm thấy 3 học sinh trùng khớp');
    expect(res.text).toContain('1. **Minh A** [Mã: HV01] - Lớp: Lớp 1');
    expect(res.text).toContain('2. **Minh B** [Mã: HV02] - Lớp: Lớp 2');
    expect(res.text).toContain('(và 1 học sinh khác)');
    expect(res.suggestedPrompts).toEqual(['Em thứ 1', 'Em thứ 2']);
  });

  it('formats not found message', () => {
    const res = formatNotFoundMessage('Trần Văn Không Có', 'học sinh');
    expect(res.text).toContain('Không tìm thấy thông tin học sinh');
    expect(res.text).toContain('Trần Văn Không Có');
  });
});
