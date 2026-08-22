// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseClosingRecordsTable } from './CourseClosingRecordsTable.js';

const sampleRecords = [
  {
    id: 'c1__s1',
    studentCode: 'HV001',
    studentName: 'Nguyễn Văn An',
    className: 'IELTS 6.0',
    teacherName: 'Trần Minh',
    closingMonth: '2026-07',
    evaluationSnapshot: { totalScore: 84, classification: 'good' },
    tuitionSnapshot: { amount: 2_400_000, paymentDueDate: '2026-08-01' },
    evaluationDocument: { status: 'ready' },
    tuitionDocument: { status: 'ready' },
    displayStatus: 'complete',
  },
];

describe('CourseClosingRecordsTable', () => {
  beforeEach(() => localStorage.setItem('language', 'en'));

  it('renders one preview action and no download action for each ready document', async () => {
    const onDocumentPreview = vi.fn();
    render(
      <CourseClosingRecordsTable
        records={sampleRecords}
        role="office"
        onDocumentPreview={onDocumentPreview}
        onPreview={vi.fn()}
      />
    );

    expect(screen.getByText('Final score')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /IELTS 6.0/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download evaluation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download tuition/i })).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Open evaluation for Nguyễn Văn An/i })
    );
    expect(onDocumentPreview).toHaveBeenCalledWith(sampleRecords[0], 'evaluation');
  });

  it('hides every evaluation column for accounting', () => {
    render(
      <CourseClosingRecordsTable
        records={sampleRecords}
        role="accounting"
        onDocumentPreview={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    expect(screen.queryByText('Final score')).not.toBeInTheDocument();
    expect(screen.queryByText('Classification')).not.toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn An')).toBeInTheDocument();
  });

  it('opens the record preview from an accessible action', async () => {
    const onPreview = vi.fn();
    render(
      <CourseClosingRecordsTable
        records={sampleRecords}
        role="office"
        onDocumentPreview={vi.fn()}
        onPreview={onPreview}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /Preview record for Nguyễn Văn An/i })
    );
    expect(onPreview).toHaveBeenCalledWith(sampleRecords[0]);
  });
});
