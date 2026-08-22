// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Profile from './Profile';
import { LanguageProvider } from '../../lib/i18n/useLanguage';
import * as AuthContext from '../../contexts/AuthContext';

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../lib/zalo/zaloBotService', () => ({
  getMyZaloBotLink: vi.fn().mockResolvedValue({ botEnabled: false, link: null }),
}));

describe('Profile - ZaloBotLinkCard integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: { uid: 'user1', email: 'test@example.com', providerData: [] } as any,
      profile: { role: 'teacher', displayName: 'Test User' } as any,
      updateProfileState: vi.fn(),
      loading: false,
    } as any);
  });

  const renderProfile = (role: string) => {
    const profile = {
      id: '1',
      uid: 'user1',
      email: 'test@example.com',
      role,
      displayName: 'Test User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;

    return render(
      <LanguageProvider>
        <Profile profile={profile} />
      </LanguageProvider>
    );
  };

  it('renders ZaloBotLinkCard for teacher role in security tab', async () => {
    renderProfile('teacher');

    // Go to security tab
    const securityTab = screen.getByText(/Bảo mật|Security/i);
    securityTab.click();

    await waitFor(() => {
      expect(screen.getByTestId('zalo-bot-link-card')).toBeInTheDocument();
    });
  });

  it('does not render ZaloBotLinkCard for student role in security tab', async () => {
    renderProfile('student');

    // Go to security tab
    const securityTab = screen.getByText(/Bảo mật|Security/i);
    securityTab.click();

    await waitFor(() => {
      expect(screen.queryByTestId('zalo-bot-link-card')).not.toBeInTheDocument();
    });
  });
});
