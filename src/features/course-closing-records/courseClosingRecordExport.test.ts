import { describe, expect, it } from 'vitest';
import { exportCourseClosingRecordsToCsv } from './courseClosingRecordExport.js';

const sampleRecords: any[] = [
  {
    id: 'c1__s1',
    studentCode: 'HV001',
    studentName: 'Nguyễn Văn An',
    className: 'IELTS 6.0',
    teacherName: 'Trần Minh',
    closingMonth: '2026-07',
    evaluationSnapshot: {
      totalScore: 84,
      classification: 'good',
    },
    tuitionSnapshot: {
      amount: 2400000,
      paymentDueDate: '2026-08-01',
    },
    evaluationDocument: { status: 'ready' },
    tuitionDocument: { status: 'ready' },
    displayStatus: 'ready',
  },
];

describe('exportCourseClosingRecordsToCsv', () => {
  it('exports full report for admin/office with BOM', () => {
    const csv = exportCourseClosingRecordsToCsv(sampleRecords, 'office', '2026-07');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Mã HV');
    expect(csv).toContain('Điểm TK');
    expect(csv).toContain('Nguyễn Văn An');
  });

  it('exports tuition-only report for accounting without evaluation fields', () => {
    const csv = exportCourseClosingRecordsToCsv(sampleRecords, 'accounting', '2026-07');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Mã HV');
    expect(csv).not.toContain('Điểm TK');
    expect(csv).not.toContain('Xếp loại');
    expect(csv).toContain('Nguyễn Văn An');
    expect(csv).toContain('2400000');
  });

  it('translates backfilled statuses instead of leaking raw codes', () => {
    const backfilled: any[] = [
      {
        ...sampleRecords[0],
        evaluationDocument: { status: 'pending' },
        tuitionDocument: { status: 'not_requested' },
        displayStatus: 'pending',
      },
      {
        ...sampleRecords[0],
        id: 'c1__s2',
        evaluationDocument: { status: 'not_requested' },
        tuitionDocument: { status: 'not_requested' },
        displayStatus: 'not_requested',
      },
      {
        ...sampleRecords[0],
        id: 'c1__s3',
        displayStatus: 'complete',
      },
    ];

    const csv = exportCourseClosingRecordsToCsv(backfilled, 'office', '2026-07');
    expect(csv).toContain('Đang tạo');
    expect(csv).toContain('Chưa yêu cầu');
    expect(csv).toContain('Hoàn tất');
    expect(csv).not.toContain('not_requested');
    expect(csv).not.toContain('"pending"');
    expect(csv).not.toContain('"complete"');
  });
});
