// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ExpenseTransactionDetails } from './ExpenseTransactionDetails';
import {
  detailsText,
  expenseRow,
  incomeRow,
  unavailableLegacyRow,
  walletOnlyRow,
} from './financeReportDetailsTestFixtures';
import { IncomeTransactionDetails } from './IncomeTransactionDetails';

it('renders receipt, invoice, student, phone, method, money and allocation details', () => {
  render(<IncomeTransactionDetails language="vi" t={detailsText} rows={[incomeRow]} />);
  expect(screen.getAllByText('PT-260730-001').length).toBeGreaterThan(0);
  expect(screen.getAllByText('INV-260730-001').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Nguyễn An').length).toBeGreaterThan(0);
  expect(screen.getAllByText('0901234567').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Chuyển khoản').length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem phân bổ' })[0]);
  expect(screen.getAllByText('IELTS 6.5').length).toBeGreaterThan(0);
  expect(screen.getAllByText('1.000.000 đ').length).toBeGreaterThan(0);
});

it('labels wallet-only cash and unavailable legacy links', () => {
  render(
    <IncomeTransactionDetails
      language="vi"
      t={detailsText}
      rows={[walletOnlyRow, unavailableLegacyRow]}
    />
  );
  expect(screen.getAllByText('Tiền đang giữ trong ví').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThan(0);
});

it('renders expense content, payee, creator and refund student separately', () => {
  render(<ExpenseTransactionDetails language="vi" t={detailsText} rows={[expenseRow]} />);
  expect(screen.getAllByText('PC-260730-001').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Hoàn tiền học sinh').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Hoàn học phí thừa').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Phụ huynh Nguyễn An').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Kế toán Lan').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Nguyễn An').length).toBeGreaterThan(0);
});
