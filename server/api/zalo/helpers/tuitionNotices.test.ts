import { afterEach, describe, expect, it, vi } from 'vitest';
import { markTuitionNoticeLedgerSent, type CourseFeeLedgerMatch } from './tuitionNotices.js';
import { ZALO_TRACKING_WRITE_TIMEOUT_MS } from './zaloBaseHelpers.js';
import { createZaloPayloadSnapshot } from './zaloTemplatePolicy.js';

describe('tuition notice ledger tracking', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('captures exact tuition variables without redacting student codes', () => {
    expect(
      createZaloPayloadSnapshot({
        templateId: 'tuition-template',
        phone: '84900000001',
        templateData: {
          student_name: 'Nguyễn An',
          student_code: 'HV001',
          amount: 1_000_000,
          semester: 'Khóa 08/2026',
          due_date: '24/08/2026',
        },
        capturedAt: '2026-08-11T10:00:00.000Z',
      }).templateData
    ).toEqual({
      student_name: 'Nguyễn An',
      student_code: 'HV001',
      amount: 1_000_000,
      semester: 'Khóa 08/2026',
      due_date: '24/08/2026',
    });
  });

  it('does not let a slow ledger tracking write hang a successful tuition send', async () => {
    vi.useFakeTimers();
    const update = vi.fn(() => new Promise(() => {}));
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({ update })),
      })),
    };
    const ledger: CourseFeeLedgerMatch = {
      id: 'ledger-1',
      data: { tuitionNoticeCount: 2 },
    };

    let settled = false;
    const promise = markTuitionNoticeLedgerSent(
      db as any,
      ledger,
      { uid: 'office-1' },
      { uid: 'office-1', role: 'office', name: 'Office' },
      { amount: 1000000, messageId: 'msg-1', paymentDueDate: '24/04/2026' },
      'office'
    ).then((count) => {
      settled = true;
      return count;
    });

    await vi.advanceTimersByTimeAsync(ZALO_TRACKING_WRITE_TIMEOUT_MS + 1);
    await expect(promise).resolves.toBe(3);
    expect(settled).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
