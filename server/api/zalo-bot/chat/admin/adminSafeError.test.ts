import { describe, expect, it } from 'vitest';
import { toSafeAdminError } from './adminSafeError.js';

describe('adminSafeError mapper', () => {
  it('maps known safe error codes correctly', () => {
    const err = { code: 'audit_failed' };
    const safe = toSafeAdminError(err);
    expect(safe.code).toBe('audit_failed');
    expect(safe.statusCode).toBe(503);
    expect(safe.safeMessage).toContain('nhật ký bảo mật');
  });

  it('redacts raw database errors, file paths, and unknown exceptions', () => {
    const rawDbError = new Error(
      'DocumentStore query failed: collection users where phone == 0912345678 failed with internal exception at /server/api/db.ts:45'
    );
    const safe = toSafeAdminError(rawDbError);
    expect(safe.code).toBe('internal_error');
    expect(safe.statusCode).toBe(500);
    expect(safe.safeMessage).not.toContain('DocumentStore');
    expect(safe.safeMessage).not.toContain('0912345678');
    expect(safe.safeMessage).not.toContain('/server/');
  });

  it('handles abort / timeout errors safely', () => {
    const abortErr = new Error('AbortError');
    abortErr.name = 'AbortError';
    const safe = toSafeAdminError(abortErr);
    expect(safe.code).toBe('deadline_exceeded');
    expect(safe.statusCode).toBe(504);
  });
});
