// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import { StaffTab } from './StaffTab';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe('StaffTab', () => {
  it('formats blocked dates as dd/MM/yyyy', () => {
    const noop = vi.fn();

    render(
      <StaffTab
        language="en"
        t={translations.en.adminDashboard}
        ap={translations.en.adminPage}
        allowedTeachers={[]}
        blockedTeachers={[{ email: 'blocked@example.com', blockedAt: '2026-06-05T10:30:00.000Z' }]}
        registeredStaff={[]}
        classes={[]}
        newEmail=""
        setNewEmail={noop}
        actionLoading={null}
        confirmDelete={null}
        setShowCreateStaffModal={noop}
        setSelectedStaffProfile={noop}
        handleAddEmail={async () => undefined}
        handleRemoveEmail={async () => undefined}
        handleUnblockEmail={async () => undefined}
        handleDeleteBlockedEmail={async () => undefined}
        handleDeleteUserAccount={async () => undefined}
      />
    );

    expect(screen.getByText((content) => content.includes('05/06/2026'))).toBeInTheDocument();
  });
});
