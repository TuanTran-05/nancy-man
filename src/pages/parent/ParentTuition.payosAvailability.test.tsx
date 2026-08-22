// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ParentTuition from './ParentTuition';

const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return {
    toast,
    createPayOSPayment: vi.fn(),
  };
});

vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'parent-1', role: 'parent', studentId: 'student-1' } }),
}));

vi.mock('../../hooks/useParentTuitionData', () => ({
  useParentTuitionData: () => ({
    feeLedgers: [
      {
        id: 'ledger-1',
        amount: 2_000_000,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termStart: '2026-08-01',
        termEnd: '2026-10-31',
      },
    ],
    feeReceipts: [],
    loading: false,
  }),
}));

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return { useLanguage: () => ({ language: 'vi', t: translations.vi }) };
});

vi.mock('../../lib/api/payosApi', () => ({
  createPayOSPayment: mocks.createPayOSPayment,
  getPayOSPaymentStatus: vi.fn(),
}));

describe('ParentTuition PayOS availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the in-development state without creating a PayOS payment', () => {
    render(
      <MemoryRouter>
        <ParentTuition />
      </MemoryRouter>
    );

    const paymentButton = screen.getByRole('button', {
      name: /Thanh toán qua payOS.*Đang phát triển/i,
    });

    fireEvent.click(paymentButton);

    expect(mocks.toast).toHaveBeenCalledWith(
      'Tính năng thanh toán qua payOS đang được phát triển.',
      { icon: '🚧' }
    );
    expect(mocks.createPayOSPayment).not.toHaveBeenCalled();
    expect(document.querySelector('script[data-payos-checkout]')).toBeNull();
  });
});
