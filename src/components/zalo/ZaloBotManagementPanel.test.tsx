// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZaloBotManagementPanel } from './ZaloBotManagementPanel';
import {
  getZaloBotAdminOverview,
  adminLinkZaloBotChat,
  adminUnlinkZaloBotStaff,
  adminSendZaloBotTest,
} from '../../lib/zalo/zaloBotService';
import toast from 'react-hot-toast';

vi.mock('../../lib/zalo/zaloBotService', () => ({
  getZaloBotAdminOverview: vi.fn(),
  adminLinkZaloBotChat: vi.fn(),
  adminUnlinkZaloBotStaff: vi.fn(),
  adminSendZaloBotTest: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockOverview = {
  botEnabled: true,
  overview: {
    links: [
      {
        staffId: 'staff-1',
        chatIdHash: 'hash-1',
        displayName: 'John Doe Link',
        role: 'teacher' as const,
        status: 'active' as const,
        linkedMethod: 'admin' as const,
        linkedAt: '2026-08-01T00:00:00.000Z',
        lastSeenAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    pendingChats: [
      {
        chatIdHash: 'hash-2',
        displayName: 'Jane Chat',
        username: 'jane_chat',
        lastSeenAt: '2026-08-05T00:00:00.000Z',
      },
      {
        chatIdHash: 'hash-3',
        displayName: 'Bob Chat',
        // username is undefined
        lastSeenAt: '2026-08-06T00:00:00.000Z',
      },
    ],
    staff: [
      {
        uid: 'staff-1',
        displayName: 'John Doe',
        email: 'john@example.com',
        role: 'teacher' as const,
      },
      {
        uid: 'staff-2',
        displayName: 'Jane Smith',
        email: 'jane@example.com',
        role: 'office' as const,
      },
      {
        uid: 'staff-3',
        displayName: 'Admin User',
        email: 'admin@example.com',
        role: 'admin' as const,
      },
    ],
    recentMessages: [],
  },
};

describe('ZaloBotManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getZaloBotAdminOverview).mockResolvedValue(mockOverview);
    vi.mocked(adminLinkZaloBotChat).mockResolvedValue({ success: true });
    vi.mocked(adminUnlinkZaloBotStaff).mockResolvedValue({ success: true });
  });

  it('renders heading and separation note', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getByText('Zalo Bot nội bộ')).toBeInTheDocument());
    expect(
      screen.getByText(
        /Manage internal staff bot connections. This is separate from Zalo OA \/ ZNS messaging to parents./
      )
    ).toBeInTheDocument();
  });

  it('warns before retrying a delivery with an ambiguous provider outcome', async () => {
    vi.mocked(getZaloBotAdminOverview).mockResolvedValueOnce({
      ...mockOverview,
      overview: {
        ...mockOverview.overview,
        recentMessages: [
          {
            id: 'message-1',
            staffId: 'staff-1',
            role: 'teacher',
            chatIdHash: 'hash-1',
            digestDate: '2026-08-16',
            messageType: 'daily_digest',
            status: 'failed',
            attempts: 1,
            errorCode: 'transient',
            deliveryAmbiguous: true,
            createdAt: '2026-08-16T14:30:00.000Z',
            updatedAt: '2026-08-16T14:30:05.000Z',
          },
        ],
      },
    });

    render(<ZaloBotManagementPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('ambiguous outcome');
    expect(screen.getByText('failed · ambiguous')).toBeInTheDocument();
    expect(screen.getByText('transient')).toBeInTheDocument();
  });

  it('renders pending chat rows with optional username and lastSeenAt', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    // jane chat has username
    expect(screen.getByText(/Jane Chat \(jane_chat\) - Last seen:/)).toBeInTheDocument();

    // bob chat has no username, should not render "undefined"
    const bobOption = screen.getByText(/Bob Chat - Last seen:/);
    expect(bobOption.textContent).not.toMatch(/undefined/i);
  });

  it('renders staff selector with active/unlinked indicator', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    expect(screen.getByText(/John Doe \(teacher\) \[active\]/)).toBeInTheDocument();
    expect(screen.getByText(/Jane Smith \(office\) \[unlinked\]/)).toBeInTheDocument();
  });

  it('refuses to submit without both selections', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    const linkButton = screen.getByRole('button', { name: /Link Account/i });
    expect(linkButton).toBeDisabled();

    // Select pending chat
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'hash-2' } });
    expect(linkButton).toBeDisabled();

    // Select staff
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'staff-2' } });
    expect(linkButton).not.toBeDisabled();
  });

  it('link button POSTs to adminLinkZaloBotChat and refreshes on success', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'hash-2' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'staff-2' } });

    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));

    await waitFor(() => {
      expect(adminLinkZaloBotChat).toHaveBeenCalledWith({
        staffId: 'staff-2',
        chatIdHash: 'hash-2',
      });
      expect(getZaloBotAdminOverview).toHaveBeenCalledTimes(2); // Initial load + refresh
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it('unlink POSTs to adminUnlinkZaloBotStaff and refreshes', async () => {
    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getByText(/John Doe Link/)).toBeInTheDocument());

    const unlinkButton = screen.getByRole('button', { name: 'Unlink' });
    fireEvent.click(unlinkButton);

    await waitFor(() => {
      expect(adminUnlinkZaloBotStaff).toHaveBeenCalledWith('staff-1');
      expect(getZaloBotAdminOverview).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it('renders Send Test button only for active eligible links and POSTs on click', async () => {
    // Add another link to mockOverview for a mismatch role to prove it doesn't show button
    const mixedOverview = {
      ...mockOverview,
      overview: {
        ...mockOverview.overview,
        links: [
          ...mockOverview.overview.links,
          {
            staffId: 'staff-2', // has role 'office'
            chatIdHash: 'hash-99',
            displayName: 'Mismatch Role Link',
            role: 'teacher' as const, // link role 'teacher' != user role 'office'
            status: 'active' as const,
            linkedMethod: 'admin' as const,
            linkedAt: '2026-08-01T00:00:00.000Z',
            lastSeenAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
    };
    vi.mocked(getZaloBotAdminOverview).mockResolvedValueOnce(mixedOverview);
    vi.mocked(adminSendZaloBotTest).mockResolvedValueOnce({ success: true, messageId: 'm1' });

    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getByText(/John Doe Link/)).toBeInTheDocument());

    // Only one Test button should be visible (for staff-1)
    const testButtons = screen.getAllByRole('button', { name: /Test/i });
    expect(testButtons.length).toBe(1);

    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(adminSendZaloBotTest).toHaveBeenCalledWith('staff-1');
      expect(getZaloBotAdminOverview).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith('Successfully queued test message');
    });
  });

  it('failed link shows error and preserves selection', async () => {
    vi.mocked(adminLinkZaloBotChat).mockRejectedValueOnce(new Error('Link failed error'));

    render(<ZaloBotManagementPanel />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    const chatSelect = screen.getAllByRole('combobox')[0];
    const staffSelect = screen.getAllByRole('combobox')[1];

    fireEvent.change(chatSelect, { target: { value: 'hash-2' } });
    fireEvent.change(staffSelect, { target: { value: 'staff-2' } });

    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Link failed error');
      // Values preserved
      expect(chatSelect).toHaveValue('hash-2');
      expect(staffSelect).toHaveValue('staff-2');
    });
  });

  it('shows read-only panel with explanation when botEnabled is false', async () => {
    vi.mocked(getZaloBotAdminOverview).mockResolvedValueOnce({
      botEnabled: false,
      overview: mockOverview.overview,
    });

    render(<ZaloBotManagementPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Bot is currently disabled/i)).toBeInTheDocument();
    });

    // Inputs disabled
    const selects = screen.getAllByRole('combobox');
    expect(selects[0]).toBeDisabled();
    expect(selects[1]).toBeDisabled();

    expect(screen.getByRole('button', { name: /Link Account/i })).toBeDisabled();

    const unlinkButtons = screen.getAllByRole('button', { name: 'Unlink' });
    expect(unlinkButtons[0]).toBeDisabled();
  });
});
