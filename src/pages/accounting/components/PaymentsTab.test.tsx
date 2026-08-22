// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import type { OnlinePaymentRequest } from '../../../types';
import { PaymentsTab } from './PaymentsTab';

const payment: OnlinePaymentRequest = {
  id: 'p1',
  orderCode: 2_607_280_001,
  ledgerId: 'l1',
  studentId: 's1',
  studentName: 'Nguyễn An',
  classId: 'c1',
  className: 'A1',
  parentUid: 'parent-1',
  amount: 900_000,
  currency: 'VND',
  provider: 'payos',
  status: 'paid',
  createdAt: '2026-07-28T00:00:00.000Z',
};

describe('PaymentsTab student profile access', () => {
  it('links the student name to the finance profile in a new browser tab', () => {
    render(
      <PaymentsTab
        activeTab="payments"
        handleReconcilePayments={vi.fn()}
        reconcilingPayments={false}
        loadPayments={vi.fn()}
        paymentsLoading={false}
        paymentHealth={{
          pendingOlderThan30m: 0,
          needsReviewOpen: 0,
          staleCreatingGatewaySession: 0,
          failedWebhookEvents24h: 0,
        }}
        filteredPayments={[payment]}
        refreshingPaymentId={null}
        handleRefreshPaymentStatus={vi.fn()}
        setResolveTarget={vi.fn()}
        setResolveDecision={vi.fn()}
        setResolveReason={vi.fn()}
        paymentsHasMore={false}
        language="vi"
        t={translations.vi}
      />
    );

    const link = screen.getByRole('link', { name: /Nguyễn An/ });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
