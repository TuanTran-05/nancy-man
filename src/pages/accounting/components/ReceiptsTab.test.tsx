// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../../../lib/i18n/translations';
import { ReceiptsTab } from './ReceiptsTab';

describe('ReceiptsTab', () => {
  it('keeps the standalone create action in legacy receipt mode', async () => {
    const user = userEvent.setup();
    const setShowReceiptModal = vi.fn();

    render(
      <ReceiptsTab
        activeTab="receipts"
        setShowReceiptModal={setShowReceiptModal}
        filteredReceipts={[]}
        studentMap={{}}
        classMap={{}}
        actionLoading={null}
        handlePostReceipt={vi.fn()}
        handleVoidReceipt={vi.fn()}
        receiptsHasMore={false}
        receiptsLoading={false}
        loadReceipts={vi.fn()}
        language="vi"
        t={translations.vi}
      />
    );

    await user.click(screen.getByRole('button', { name: /Tạo phiếu thu/i }));
    expect(setShowReceiptModal).toHaveBeenCalledWith(true);
  });
});
