// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseClosingRecordsHeader } from './CourseClosingRecordsHeader.js';

describe('CourseClosingRecordsHeader', () => {
  beforeEach(() => localStorage.setItem('language', 'en'));

  it('renders accessible filters with role-specific aggregate statuses', () => {
    render(
      <CourseClosingRecordsHeader
        month="2026-07"
        onMonthChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        records={[]}
        truncated={false}
        role="office"
      />
    );

    expect(screen.getByRole('searchbox', { name: 'Search archived records' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Missing evaluation' })).toBeInTheDocument();
  });

  it('lets non-accounting roles filter records that have no document yet', () => {
    render(
      <CourseClosingRecordsHeader
        month="2026-07"
        onMonthChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        records={[]}
        truncated={false}
        role="office"
      />
    );

    expect(screen.getByRole('option', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not requested' })).toBeInTheDocument();
  });

  it('displays warning when records are truncated', () => {
    render(
      <CourseClosingRecordsHeader
        month="2026-07"
        onMonthChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        records={[]}
        truncated={true}
        role="office"
      />
    );

    expect(screen.getByText(/Showing at most 1,000 records/i)).toBeInTheDocument();
  });

  it('shows tuition artifact statuses and hides document type for accounting', () => {
    render(
      <CourseClosingRecordsHeader
        month="2026-07"
        onMonthChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        records={[]}
        truncated={false}
        role="accounting"
      />
    );

    expect(screen.getByRole('option', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not requested' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Document type')).not.toBeInTheDocument();
  });
});
