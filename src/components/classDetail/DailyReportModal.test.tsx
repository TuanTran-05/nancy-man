// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyReportModal } from './DailyReportModal';
import { translations } from '../../lib/i18n/translations';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: translations.en }),
}));

describe('DailyReportModal export loading', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    classData: { id: 'class-1', name: '6A Global Success' } as any,
    dailyReports: [],
    formData: {
      date: '2026-06-01',
      generalComment: 'Class was stable.',
      additionalNotes: '',
    },
    setFormData: vi.fn(),
    onSubmit: vi.fn(),
    onExport: vi.fn(),
    isSaving: false,
  };

  it('shows loading while exporting the daily report PDF', () => {
    render(<DailyReportModal {...baseProps} isExporting={true} />);

    const exportButton = screen.getByRole('button', { name: /exporting/i });
    expect(exportButton).toHaveAttribute('aria-busy', 'true');
    expect(exportButton).toBeDisabled();
  });
});
