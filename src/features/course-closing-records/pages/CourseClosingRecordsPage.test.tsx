// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../lib/api/apiClient.js';
import { COURSE_CLOSING_SEARCH_DEBOUNCE_MS } from '../courseClosingRecordsQueries.js';
import { useCourseClosingRecordsStore } from '../courseClosingRecordsStore.js';
import { CourseClosingRecordsPage } from './CourseClosingRecordsPage.js';

vi.mock('../../../lib/api/apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

// The record queries scope their cache keys by viewer, so the page needs an
// identity even when the test only cares about rendering.
vi.mock('../../../contexts/AuthContext.js', () => ({
  useAuth: () => ({ profile: { uid: 'accounting-1', role: 'accounting' } }),
}));

const readyRecord = {
  id: 'course-1__student-1',
  studentName: 'Student One',
  studentCode: 'S001',
  className: 'Class One',
  teacherName: 'Teacher One',
  evaluationSnapshot: { totalScore: 88, classification: 'good' },
  tuitionSnapshot: { amount: 2_500_000, paymentDueDate: '2026-08-01' },
  evaluationDocument: { status: 'ready' },
  tuitionDocument: { status: 'ready' },
  displayStatus: 'complete',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('CourseClosingRecordsPage', () => {
  beforeEach(() => {
    localStorage.setItem('language', 'en');
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    useCourseClosingRecordsStore.setState({
      month: '2026-01',
      searchQuery: '',
      submittedSearchQuery: '',
      statusFilter: 'all',
      documentTypeFilter: 'all',
    } as any);
    vi.mocked(apiRequest)
      .mockReset()
      .mockImplementation(async (path: string) => {
        if (path.includes('course-closing-record-month')) {
          return { success: true, month: '2026-07' } as any;
        }
        return { success: true, month: '2026-07', records: [], truncated: false } as any;
      });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the archive header, deployment notice, and empty state', async () => {
    render(<CourseClosingRecordsPage userRole="office" />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByText('Course-closing archive')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/deployment/i);
    expect(await screen.findByText('No archived records found')).toBeInTheDocument();
  });

  it('keeps the user-selected month authoritative after latest-month discovery', async () => {
    render(<CourseClosingRecordsPage userRole="office" />, {
      wrapper: createWrapper(),
    });

    const monthInput = await screen.findByLabelText('Closing month');
    await waitFor(() => expect(monthInput).toHaveValue('2026-07'));
    fireEvent.change(monthInput, { target: { value: '2026-05' } });

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-records?month=2026-05'
      )
    );
    expect(monthInput).toHaveValue('2026-05');
  });

  it('submits the search form before adding q to the records query', async () => {
    const user = userEvent.setup();
    render(<CourseClosingRecordsPage userRole="office" />, {
      wrapper: createWrapper(),
    });

    const search = await screen.findByRole('searchbox', {
      name: 'Search archived records',
    });
    await user.type(search, 'An & Bình');
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('&q='));

    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-records?month=2026-07&q=An+%26+B%C3%ACnh'
      )
    );
  });

  it('debounces submitted searches and requests only the last value', async () => {
    vi.useFakeTimers();
    try {
      render(<CourseClosingRecordsPage userRole="office" />, { wrapper: createWrapper() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const searchRequests = () =>
        vi
          .mocked(apiRequest)
          .mock.calls.map(([path]) => String(path))
          .filter((path) => path.includes('course-closing-records') && path.includes('q='));

      act(() => {
        useCourseClosingRecordsStore.setState({ submittedSearchQuery: 'An' } as any);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COURSE_CLOSING_SEARCH_DEBOUNCE_MS - 100);
      });
      expect(searchRequests()).toEqual([]);

      act(() => {
        useCourseClosingRecordsStore.setState({ submittedSearchQuery: 'Binh' } as any);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COURSE_CLOSING_SEARCH_DEBOUNCE_MS);
      });

      expect(searchRequests()).toEqual([
        '/api/v1/classes/course-closing-records?month=2026-07&q=Binh',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('views the stored DOCX through Office Viewer and downloads the original attachment', async () => {
    const user = userEvent.setup();
    const downloadedLinks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadedLinks.push({ href: this.href, download: this.download });
    });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('course-closing-record-month')) {
        return { success: true, month: '2026-07' } as any;
      }
      if (path.includes('course-closing-records?')) {
        return {
          success: true,
          month: '2026-07',
          records: [readyRecord],
          truncated: false,
        } as any;
      }
      if (path.includes('mode=inline')) {
        return {
          success: true,
          url: 'https://storage.test/evaluation.docx?token=a&signature=b',
          downloadFilename: 'Student_One_Evaluation.docx',
          expiresAt: '2026-07-27T10:10:00.000Z',
        } as any;
      }
      if (path.includes('mode=attachment')) {
        return {
          success: true,
          url: 'https://storage.test/evaluation.docx?token=download',
          downloadFilename: 'Student_One_Evaluation.docx',
          expiresAt: '2026-07-27T10:10:00.000Z',
        } as any;
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<CourseClosingRecordsPage userRole="admin" />, {
      wrapper: createWrapper(),
    });

    await user.click(
      await screen.findByRole('button', { name: /Open evaluation for Student One/i })
    );

    const frame = await screen.findByTitle('Evaluation document for Student One');
    expect(frame).toHaveAttribute(
      'src',
      'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fstorage.test%2Fevaluation.docx%3Ftoken%3Da%26signature%3Db'
    );
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/classes/course-closing-record-file?recordId=course-1__student-1&documentType=evaluation&mode=inline'
    );

    await user.click(screen.getByRole('button', { name: 'Download DOCX' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-record-file?recordId=course-1__student-1&documentType=evaluation&mode=attachment'
      )
    );
    expect(downloadedLinks).toEqual([
      {
        href: 'https://storage.test/evaluation.docx?token=download',
        download: 'Student_One_Evaluation.docx',
      },
    ]);
  });

  it('keeps the stored DOCX viewer open when attachment download fails', async () => {
    const user = userEvent.setup();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('course-closing-record-month')) {
        return { success: true, month: '2026-07' } as any;
      }
      if (path.includes('course-closing-records?')) {
        return {
          success: true,
          month: '2026-07',
          records: [readyRecord],
          truncated: false,
        } as any;
      }
      if (path.includes('mode=inline')) {
        return {
          success: true,
          url: 'https://storage.test/evaluation.docx?token=inline',
          downloadFilename: 'Student_One_Evaluation.docx',
          expiresAt: '2026-07-27T10:10:00.000Z',
        } as any;
      }
      if (path.includes('mode=attachment')) {
        throw new Error('Attachment unavailable');
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<CourseClosingRecordsPage userRole="admin" />, {
      wrapper: createWrapper(),
    });

    await user.click(
      await screen.findByRole('button', { name: /Open evaluation for Student One/i })
    );
    const frame = await screen.findByTitle('Evaluation document for Student One');

    await user.click(screen.getByRole('button', { name: 'Download DOCX' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not download the DOCX.');
    expect(frame).toBeInTheDocument();
  });
});
