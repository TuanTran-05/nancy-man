// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseClosingRecordPreviewModal } from './CourseClosingRecordPreviewModal.js';

const record: any = {
  id: 'course-1__student-1',
  studentName: 'Student One',
  studentCode: 'S001',
  className: 'Class One',
  teacherName: 'Teacher One',
  evaluationSnapshot: {
    totalScore: 88,
    finalExamScore: 90,
    classification: 'good',
    positivePoints: ['Pronunciation'],
    improvementPoints: 'Fluency',
  },
  tuitionSnapshot: {
    amount: 2_500_000,
    paymentDueDate: '2026-08-01',
  },
};

describe('CourseClosingRecordPreviewModal', () => {
  beforeEach(() => localStorage.setItem('language', 'en'));

  it('shows both snapshots to office', () => {
    render(<CourseClosingRecordPreviewModal record={record} role="office" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Archived record preview' })).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText(/2\.500\.000/)).toBeInTheDocument();
  });

  it('never renders evaluation fields for accounting', () => {
    render(<CourseClosingRecordPreviewModal record={record} role="accounting" onClose={vi.fn()} />);

    expect(screen.queryByText('Evaluation')).not.toBeInTheDocument();
    expect(screen.queryByText('88')).not.toBeInTheDocument();
    expect(screen.getByText(/2\.500\.000/)).toBeInTheDocument();
  });

  it('escapes transformed route containers so the dialog stays in the viewport', () => {
    render(
      <div style={{ transform: 'translateX(0)' }}>
        <CourseClosingRecordPreviewModal record={record} role="office" onClose={vi.fn()} />
      </div>
    );

    const dialog = screen.getByRole('dialog', { name: 'Archived record preview' });

    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });
});
