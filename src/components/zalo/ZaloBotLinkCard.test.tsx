// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ZaloBotLinkCard } from './ZaloBotLinkCard';
import * as zaloBotService from '../../lib/zalo/zaloBotService';
import { LanguageProvider } from '../../lib/i18n/useLanguage';

vi.mock('../../lib/zalo/zaloBotService', () => ({
  getMyZaloBotLink: vi.fn(),
  createMyZaloBotLinkCode: vi.fn(),
  unlinkMyZaloBotChat: vi.fn(),
}));

// Mock window.confirm
beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = vi.fn().mockReturnValue(true);
});

describe('ZaloBotLinkCard', () => {
  const renderComponent = (role = 'teacher') => {
    return render(
      <LanguageProvider>
        <ZaloBotLinkCard role={role} />
      </LanguageProvider>
    );
  };

  it('does not render for student role', () => {
    const { container } = renderComponent('student');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders unavailable notice if bot is disabled', async () => {
    vi.mocked(zaloBotService.getMyZaloBotLink).mockResolvedValueOnce({
      botEnabled: false,
      link: null,
    });

    renderComponent('teacher');

    await waitFor(() => {
      expect(screen.getByText(/Tính năng Zalo Bot đang bị tắt/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Tạo mã liên kết')).not.toBeInTheDocument();
  });

  it('renders create code button and handles click', async () => {
    vi.mocked(zaloBotService.getMyZaloBotLink).mockResolvedValueOnce({
      botEnabled: true,
      link: null,
    });

    renderComponent('teacher');

    const generateBtn = await screen.findByText('Tạo mã liên kết');
    expect(generateBtn).toBeInTheDocument();

    vi.mocked(zaloBotService.createMyZaloBotLinkCode).mockResolvedValueOnce({
      code: 'A1B2C3D4',
      expiresAt: '2026-01-01T00:00:00Z',
    });

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('/link A1B2C3D4')).toBeInTheDocument();
    });
  });

  it('renders active state and handles unlink', async () => {
    vi.mocked(zaloBotService.getMyZaloBotLink).mockResolvedValueOnce({
      botEnabled: true,
      link: {
        staffId: '123',
        chatIdHash: 'abc',
        displayName: 'John Doe',
        role: 'teacher',
        status: 'active',
        linkedMethod: 'self',
        linkedAt: '2026-08-15T00:00:00Z',
        lastSeenAt: '2026-08-15T00:00:00Z',
        updatedAt: '2026-08-15T00:00:00Z',
      },
    });

    renderComponent('teacher');

    await waitFor(() => {
      expect(screen.getByText(/Đã liên kết \(John Doe\)/i)).toBeInTheDocument();
    });

    const unlinkBtn = screen.getByText('Hủy liên kết');

    vi.mocked(zaloBotService.unlinkMyZaloBotChat).mockResolvedValueOnce({ success: true });
    vi.mocked(zaloBotService.getMyZaloBotLink).mockResolvedValueOnce({
      botEnabled: true,
      link: null,
    });

    fireEvent.click(unlinkBtn);

    await waitFor(() => {
      expect(zaloBotService.unlinkMyZaloBotChat).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Tạo mã liên kết')).toBeInTheDocument();
    });
  });
});
