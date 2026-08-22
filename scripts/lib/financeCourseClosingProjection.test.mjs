import { describe, expect, it } from 'vitest';
import {
  projectClassFinanceData,
  projectCourseClosingRecord,
  projectCourseFeeLedger,
} from './financeCourseClosingProjection.mjs';

describe('finance and course-closing document projections', () => {
  it('projects finance dates and NUMERIC values into the document contract', () => {
    const classData = projectClassFinanceData(
      {
        tuitionFee: '1400000.00',
        terms: [{ id: 'term-1', tuitionFee: '1400000.00' }],
      },
      [{ id: 'term-1', tuition_fee: '1400000.00' }]
    );
    expect(classData.tuitionFee).toBe(1400000);
    expect(classData.terms[0].tuitionFee).toBe(1400000);

    const historicalWithoutFee = projectClassFinanceData(
      { tuitionFee: 0, terms: [{ id: 'term-old', tuitionFee: 0 }] },
      [{ id: 'term-old', tuition_fee: null }]
    );
    expect(historicalWithoutFee.tuitionFee).toBeNull();
    expect(historicalWithoutFee.terms[0].tuitionFee).toBeNull();

    const ledger = projectCourseFeeLedger(
      { amount: '1400000.00' },
      {
        amount: '1400000.00',
        term_start: new Date('2026-07-15T17:00:00.000Z'),
        term_end: new Date('2026-09-07T17:00:00.000Z'),
        due_date: new Date('2026-07-29T17:00:00.000Z'),
      },
      {
        paid_total: '900000.00',
        discount_total: '100000.00',
        sibling_discount_total: '50000.00',
      }
    );
    expect({
      amount: ledger.amount,
      termStart: ledger.termStart,
      termEnd: ledger.termEnd,
      dueDate: ledger.dueDate,
      paidTotal: ledger.paidTotal,
      discountTotal: ledger.discountTotal,
      siblingDiscountTotal: ledger.siblingDiscountTotal,
    }).toEqual({
      amount: 1400000,
      termStart: '2026-07-16',
      termEnd: '2026-09-08',
      dueDate: '2026-07-30',
      paidTotal: 900000,
      discountTotal: 100000,
      siblingDiscountTotal: 50000,
    });
  });

  it('reassembles a normalized course closing record and both stored documents', () => {
    const record = projectCourseClosingRecord(
      {
        id: 'course-1__student-1',
        record_version: 1,
        closing_month: '2026-07',
        course_id: 'course-1',
        class_id: 'class-1',
        class_name_snapshot: 'Lớp Nâng Cao',
        course_start_date: new Date('2026-05-31T17:00:00.000Z'),
        course_end_date: new Date('2026-07-25T17:00:00.000Z'),
        student_id: 'student-1',
        student_name_snapshot: 'Đặng Ánh',
        student_code_snapshot: 'HS001',
        teacher_id: 'teacher-1',
        teacher_name_snapshot: 'Mr. Tuấn',
        evaluation_id: 'evaluation-1',
        evaluation_version: 'v1',
        evaluation_date_snapshot: new Date('2026-07-27T17:00:00.000Z'),
        evaluation_final_score: 75,
        evaluation_total_score: 87,
        evaluation_positive_points: ['Chăm học'],
        evaluation_improvement_points: 'Ôn từ vựng',
        evaluation_scores_snapshot: {
          attendance: 90,
          effort: 80,
          pronunciation: 70,
          homework: 90,
          behavior: 100,
        },
        tuition_amount_snapshot: '1400000.00',
        tuition_notice_date: new Date('2026-07-25T17:00:00.000Z'),
        next_course_start_date: new Date('2026-07-31T17:00:00.000Z'),
        next_course_end_date: new Date('2026-09-19T17:00:00.000Z'),
        tuition_final_exam_date: new Date('2026-07-27T17:00:00.000Z'),
        tuition_final_exam_score: 75,
        evaluation_availability_status: 'verified',
        tuition_availability_status: 'verified',
        created_at: '2026-07-29T10:00:00.000Z',
        updated_at: '2026-08-19T07:00:00.000Z',
      },
      [
        {
          kind: 'evaluation',
          status: 'ready',
          storage_path: 'closing/evaluation.docx',
          mime_type: 'application/test',
          template_version: 1,
          attempts: 1,
          generated_at: '2026-07-29T10:01:00.000Z',
        },
        {
          kind: 'tuition',
          status: 'ready',
          storage_path: 'closing/tuition.docx',
          template_version: 1,
          attempts: 1,
          generated_at: '2026-07-29T10:02:00.000Z',
        },
      ]
    );

    expect(record.className).toBe('Lớp Nâng Cao');
    expect(record.classNameNormalized).toBe('lop nang cao');
    expect(record.studentNameNormalized).toBe('dang anh');
    expect(record.courseStartDate).toBe('2026-06-01');
    expect(record.evaluationSnapshot.classification).toBe('good');
    expect(record.tuitionSnapshot.amount).toBe(1400000);
    expect(record.tuitionSnapshot.paymentDueDate).toBe('2026-08-15');
    expect(record.evaluationDocument.status).toBe('ready');
    expect(record.tuitionDocument.storagePath).toBe('closing/tuition.docx');
  });
});
