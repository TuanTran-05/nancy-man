// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { SettingsTab } from './SettingsTab';
import { translations } from '../../../lib/i18n/translations';

const t = translations.vi.adminDashboard;
const ap = translations.vi.adminPage;

describe('SettingsTab', () => {
  const handleAddHoliday = vi.fn();
  const handleRemoveHoliday = vi.fn();
  const handleExportExcel = vi.fn();
  const handleExportSQL = vi.fn();
  const handleStandardizeStudentIds = vi.fn();
  const handleStandardizeTeacherIds = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders holidays management section with dates', () => {
    render(
      <SettingsTab
        language="vi"
        t={t}
        ap={ap}
        isAdmin={false}
        newHoliday=""
        setNewHoliday={vi.fn()}
        holidayActionLoading={null}
        holidayDates={['2026-01-01', '2026-05-01']}
        isExporting={false}
        isStandardizing={false}
        handleAddHoliday={handleAddHoliday}
        handleRemoveHoliday={handleRemoveHoliday}
        handleExportExcel={handleExportExcel}
        handleExportSQL={handleExportSQL}
        handleStandardizeStudentIds={handleStandardizeStudentIds}
        handleStandardizeTeacherIds={handleStandardizeTeacherIds}
      />
    );

    expect(screen.getByText(ap.holidayManagement)).toBeInTheDocument();
    expect(screen.getByText('01/01/2026')).toBeInTheDocument();
    expect(screen.getByText('01/05/2026')).toBeInTheDocument();
  });

  it('triggers handleRemoveHoliday when remove button is clicked', () => {
    render(
      <SettingsTab
        language="vi"
        t={t}
        ap={ap}
        isAdmin={false}
        newHoliday=""
        setNewHoliday={vi.fn()}
        holidayActionLoading={null}
        holidayDates={['2026-01-01']}
        isExporting={false}
        isStandardizing={false}
        handleAddHoliday={handleAddHoliday}
        handleRemoveHoliday={handleRemoveHoliday}
        handleExportExcel={handleExportExcel}
        handleExportSQL={handleExportSQL}
        handleStandardizeStudentIds={handleStandardizeStudentIds}
        handleStandardizeTeacherIds={handleStandardizeTeacherIds}
      />
    );

    const deleteButtons = screen.getAllByRole('button');
    // Find the remove button for 2026-01-01
    const removeBtn = deleteButtons.find((btn) => btn.className.includes('text-red-500'));
    expect(removeBtn).toBeDefined();
    fireEvent.click(removeBtn!);

    expect(handleRemoveHoliday).toHaveBeenCalledWith('2026-01-01');
  });

  it('hides admin-only export and standardization sections when isAdmin is false', () => {
    render(
      <SettingsTab
        language="vi"
        t={t}
        ap={ap}
        isAdmin={false}
        newHoliday=""
        setNewHoliday={vi.fn()}
        holidayActionLoading={null}
        holidayDates={[]}
        isExporting={false}
        isStandardizing={false}
        handleAddHoliday={handleAddHoliday}
        handleRemoveHoliday={handleRemoveHoliday}
        handleExportExcel={handleExportExcel}
        handleExportSQL={handleExportSQL}
        handleStandardizeStudentIds={handleStandardizeStudentIds}
        handleStandardizeTeacherIds={handleStandardizeTeacherIds}
      />
    );

    expect(screen.queryByText(ap.standardizeStudentIds)).toBeNull();
    expect(screen.queryByText(ap.zaloOAConfig)).toBeNull();
    expect(screen.queryByText(t.settingsTab.exportTitle)).toBeNull();
  });
});
