import { describe, expect, it } from 'vitest';

import { createConfirmationReceipt, verifyConfirmationReceipt } from './confirmationPolicy.js';

describe('confirmation policy', () => {
  const issuedAt = new Date('2026-08-22T00:00:00.000Z');
  const receipt = createConfirmationReceipt({
    executionKey: 'SQL-20260822-01HCONFIRM',
    previewChecksum: 'sha256:preview-a',
    userId: 'ops-user-1',
    sessionId: 'ops-session-1',
    risk: 'HIGH',
    issuedAt
  });

  it('accepts only the normalized exact phrase for its own live receipt', () => {
    expect(
      verifyConfirmationReceipt({
        receipt,
        executionKey: 'SQL-20260822-01HCONFIRM',
        previewChecksum: 'sha256:preview-a',
        userId: 'ops-user-1',
        sessionId: 'ops-session-1',
        phrase:
          'ＥＸＥＣＵＴＥ　ＰＲＯＤＵＣＴＩＯＮ　ＳＱＬ－２０２６０８２２－０１ＨＣＯＮＦＩＲＭ',
        now: new Date('2026-08-22T00:04:59.999Z')
      })
    ).toEqual({ accepted: true });
  });

  it('rejects a copied confirmation when actor, session, preview, execution, phrase, or expiry differs', () => {
    const base = {
      receipt,
      executionKey: 'SQL-20260822-01HCONFIRM',
      previewChecksum: 'sha256:preview-a',
      userId: 'ops-user-1',
      sessionId: 'ops-session-1',
      phrase: 'EXECUTE PRODUCTION SQL-20260822-01HCONFIRM',
      now: new Date('2026-08-22T00:04:59.999Z')
    };

    for (const changed of [
      { ...base, userId: 'ops-user-2' },
      { ...base, sessionId: 'ops-session-2' },
      { ...base, previewChecksum: 'sha256:preview-b' },
      { ...base, executionKey: 'SQL-20260822-01HOTHER' },
      { ...base, phrase: ' EXECUTE PRODUCTION SQL-20260822-01HCONFIRM' },
      { ...base, now: new Date('2026-08-22T00:05:00.000Z') }
    ]) {
      expect(verifyConfirmationReceipt(changed)).toEqual({
        accepted: false,
        code: 'SQL_CONFIRMATION_INVALID'
      });
    }
  });
});
