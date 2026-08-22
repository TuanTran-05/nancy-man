// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassHolidays } from './ClassHolidays';
import { apiRequest } from '../../lib/api/apiClient';

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  Calendar: () => null,
  Trash2: () => null,
  Loader2: () => null,
}));

describe('ClassHolidays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
  });

  it('sends teacher-all scope when applying a holiday to all teacher classes', async () => {
    const onHolidaysUpdated = vi.fn();
    render(
      <ClassHolidays
        classId="class-a"
        holidays={[]}
        daysOfWeek={[1]}
        onHolidaysUpdated={onHolidaysUpdated}
      />
    );

    fireEvent.change(screen.getByLabelText('Holiday date'), {
      target: { value: '2026-06-15' },
    });
    fireEvent.change(screen.getByLabelText('Holiday scope'), {
      target: { value: 'teacher-all' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/save-holidays', {
        method: 'POST',
        body: {
          classId: 'class-a',
          holidays: ['2026-06-15'],
          scope: 'teacher-all',
        },
      });
    });
  });
});
