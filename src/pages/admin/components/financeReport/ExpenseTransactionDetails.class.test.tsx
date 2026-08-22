// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ExpenseTransactionDetails } from './ExpenseTransactionDetails';
import { detailsText, expenseRow } from './financeReportDetailsTestFixtures';

it('renders expense class context when present', () => {
  render(<ExpenseTransactionDetails language="vi" t={detailsText} rows={[expenseRow]} />);

  expect(screen.getAllByText('IELTS 6.5').length).toBeGreaterThan(0);
});
