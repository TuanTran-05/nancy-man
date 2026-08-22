// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OfficeDashboard from './OfficeDashboard';
import { readOfficeWeeklyDashboard } from '../../lib/api/officeDashboardApi';
import { translations } from '../../lib/i18n/translations';

vi.mock('../../lib/api/officeDashboardApi', () => ({
  readOfficeWeeklyDashboard: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'office-1', role: 'office' } }),
}));

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OfficeDashboard />
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

const payload = {
  serverTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
  teachers: [
    { uid: 'teacher-1', displayName: 'Teacher One' },
    { uid: 'teacher-2', displayName: 'Teacher Two' },
  ],
  studentCounts: {
    'class-1': { currentTotal: 20, active: 18, onLeave: 2 },
    'class-2': { currentTotal: 12, active: 12, onLeave: 0 },
  },
  classes: [
    {
      id: 'class-1',
      name: 'G5 Starters',
      teacherId: 'teacher-1',
      daysOfWeek: [3],
      startDate: '2026-06-01',
      endDate: '2026-08-29',
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
      status: 'active',
      grade: 5,
    },
    {
      id: 'class-2',
      name: 'G9 IELTS',
      teacherId: 'teacher-2',
      daysOfWeek: [1],
      startDate: '2026-03-01',
      endDate: '2026-05-31',
      startTime: '19:15',
      schedule: '19:15 - 20:45',
      room: 'Room 4',
      status: 'active',
      grade: 9,
    },
  ],
};

describe('OfficeDashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readOfficeWeeklyDashboard).mockReset();
    localStorage.setItem('language', 'vi');
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue(payload as any);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders Vietnamese copy from translations and keeps ended classes visible', async () => {
    renderDashboard();

    expect(await screen.findByText(translations.vi.officeDashboardPage.title)).toBeInTheDocument();
    expect(screen.getByText(translations.vi.officeDashboardPage.subtitle)).toBeInTheDocument();
    expect(screen.getByText('G5 Starters')).toBeInTheDocument();
    expect(screen.getByText('G9 IELTS')).toBeInTheDocument();
    expect(screen.getByText(translations.vi.officeDashboardPage.status.ended)).toHaveClass(
      'bg-rose-50',
      'text-rose-700'
    );
    expect(
      screen.getByText(translations.vi.officeDashboardPage.metrics.activeStudents)
    ).toBeInTheDocument();
  });

  it('shows paused classes with the paused label instead of the ended label', async () => {
    vi.mocked(readOfficeWeeklyDashboard).mockResolvedValue({
      ...payload,
      classes: [
        {
          id: 'class-paused',
          name: 'G7 Paused',
          teacherId: 'teacher-1',
          daysOfWeek: [0],
          startDate: '2026-03-01',
          endDate: '2026-05-31',
          startTime: '09:15',
          schedule: '09:15 - 10:45',
          status: 'paused',
          grade: 7,
        },
      ],
      studentCounts: {
        'class-paused': { currentTotal: 11, active: 0, onLeave: 11 },
      },
    } as any);

    renderDashboard();

    expect(await screen.findByText('G7 Paused')).toBeInTheDocument();
    expect(screen.getAllByText('Tạm nghỉ').length).toBeGreaterThan(0);
    expect(
      screen.queryByText(translations.vi.officeDashboardPage.status.ended)
    ).not.toBeInTheDocument();
  });

  it('gives weekly day columns enough horizontal space for readable class cards', async () => {
    renderDashboard();

    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();
    const board = screen.getByTestId('office-weekly-board');
    expect(board).toHaveClass('overflow-x-auto');

    const monday = within(board).getByRole('region', {
      name: translations.vi.officeDashboardPage.weekdays.monday,
    });
    expect(monday).toHaveClass('min-w-[250px]');
  });

  it('lets office users drag the weekly board horizontally without using the scrollbar', async () => {
    renderDashboard();

    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();
    const board = screen.getByTestId('office-weekly-board') as HTMLDivElement;
    board.scrollLeft = 120;

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 300,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(board, {
      buttons: 1,
      clientX: 220,
      pointerId: 1,
      pointerType: 'mouse',
    });

    expect(board.scrollLeft).toBe(200);
    expect(board).toHaveClass('cursor-grabbing');

    fireEvent.pointerUp(board, {
      button: 0,
      clientX: 220,
      pointerId: 1,
      pointerType: 'mouse',
    });

    expect(board).toHaveClass('cursor-grab');
  });

  it('renders English copy from the translation module', async () => {
    localStorage.setItem('language', 'en');

    renderDashboard();

    expect(await screen.findByText(translations.en.officeDashboardPage.title)).toBeInTheDocument();
    expect(screen.getByText(translations.en.officeDashboardPage.subtitle)).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: translations.en.officeDashboardPage.search.label })
    ).toHaveAttribute('placeholder', translations.en.officeDashboardPage.search.placeholder);
    expect(screen.getByText(translations.en.officeDashboardPage.status.ended)).toBeInTheDocument();
  });

  it('supports multi-select teacher grade and weekday filters', async () => {
    renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Giáo viên/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Teacher One' }));
    await userEvent.click(
      screen.getByRole('button', { name: translations.vi.officeDashboardPage.filters.close })
    );

    await userEvent.click(screen.getByRole('button', { name: /Khối/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Khối 5' }));
    await userEvent.click(
      screen.getByRole('button', { name: translations.vi.officeDashboardPage.filters.close })
    );

    await waitFor(() => {
      expect(screen.getByText('G5 Starters')).toBeInTheDocument();
      expect(screen.queryByText('G9 IELTS')).not.toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole('button', { name: translations.vi.officeDashboardPage.filters.reset })
    );
    expect(await screen.findByText('G9 IELTS')).toBeInTheDocument();
  });

  it('searches class names without changing translation copy', async () => {
    renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole('searchbox', { name: translations.vi.officeDashboardPage.search.label }),
      'IELTS'
    );

    await waitFor(() => {
      expect(screen.queryByText('G5 Starters')).not.toBeInTheDocument();
      expect(screen.getByText('G9 IELTS')).toBeInTheDocument();
    });
  });

  it('filters the board without issuing another read', async () => {
    renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();
    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);

    await userEvent.type(
      screen.getByRole('searchbox', { name: translations.vi.officeDashboardPage.search.label }),
      'IELTS'
    );
    await waitFor(() => {
      expect(screen.queryByText('G5 Starters')).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Giáo viên/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Teacher One' }));

    expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(1);
  });

  it('closes multi-select menus with Escape', async () => {
    renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Giáo viên/i }));
    expect(screen.getByRole('checkbox', { name: 'Teacher One' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'Teacher One' })).not.toBeInTheDocument();
    });
  });

  it('closes multi-select menus when clicking outside', async () => {
    renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Giáo viên/i }));
    expect(screen.getByRole('checkbox', { name: 'Teacher One' })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('searchbox', { name: translations.vi.officeDashboardPage.search.label })
    );

    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'Teacher One' })).not.toBeInTheDocument();
    });
  });

  it('shows translated retry state when loading fails', async () => {
    vi.mocked(readOfficeWeeklyDashboard).mockRejectedValueOnce(new Error('network failed'));

    renderDashboard();

    expect(
      await screen.findByText(translations.vi.officeDashboardPage.states.loadErrorTitle)
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: translations.vi.officeDashboardPage.states.loadErrorAction,
      })
    );

    await waitFor(() => {
      expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps cached classes visible and offers retry when a background refresh fails', async () => {
    vi.mocked(readOfficeWeeklyDashboard)
      .mockResolvedValueOnce(payload as any)
      .mockRejectedValueOnce(new Error('background network failure'))
      .mockResolvedValueOnce(payload as any);

    const { queryClient } = renderDashboard();
    expect(await screen.findByText('G5 Starters')).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries();
    });

    expect(screen.getByText('G5 Starters')).toBeInTheDocument();
    expect(
      await screen.findByText(translations.vi.officeDashboardPage.states.staleWarning)
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', {
        name: translations.vi.officeDashboardPage.states.staleRetry,
      })
    );

    await waitFor(() => {
      expect(readOfficeWeeklyDashboard).toHaveBeenCalledTimes(3);
      expect(
        screen.queryByText(translations.vi.officeDashboardPage.states.staleWarning)
      ).not.toBeInTheDocument();
    });
  });
});
