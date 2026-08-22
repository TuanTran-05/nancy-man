// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CENTER_LOGO_URL } from '../../lib/brand';
import LoadingScreen from './LoadingScreen';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ t: { loadingScreen: { loading: 'Loading application' } } }),
}));

describe('LoadingScreen branding', () => {
  it('shows the approved center logo', () => {
    render(<LoadingScreen />);

    expect(screen.getByRole('img', { name: 'Thiên Uy English Center' })).toHaveAttribute(
      'src',
      CENTER_LOGO_URL
    );
  });
});
