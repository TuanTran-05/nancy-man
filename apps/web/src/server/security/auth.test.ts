import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOpsStore } from '../storage/store.js';
import { provisionAccount, createAuthService } from './auth.js';
import { hashToken } from './crypto.js';
import { totpCode } from './totp.js';

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'ops-auth-'));
  const current = new Date(59_000);
  const store = createOpsStore(join(directory, 'ops.sqlite'), () => current);
  const dataKey = Buffer.alloc(32, 7);
  provisionAccount(
    store,
    {
      username: 'ops-a',
      password: 'correct horse battery staple',
      totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    },
    dataKey,
    current
  );
  return {
    store,
    auth: createAuthService({ store, dataKey, now: () => current }),
    current,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
};

describe('Ops account and sessions', () => {
  it('provisions encrypted TOTP credentials and an enrollment URI', () => {
    const f = fixture();
    try {
      const account = f.store.findAccountByUsername('ops-a')!;
      expect(account.passwordHash).not.toContain('correct horse');
      expect(account.totpSecretEnc).not.toContain('GEZDGNB');
      expect(f.store.listAuditEvents()).toContainEqual(
        expect.objectContaining({ action: 'account_provisioned' })
      );
    } finally {
      f.cleanup();
    }
  });

  it('creates a hashed session with idle and absolute expiry', async () => {
    const f = fixture();
    try {
      const session = await f.auth.authenticate({
        username: 'ops-a',
        password: 'correct horse battery staple',
        totp: '287082'
      });
      expect(session.token).not.toBe(hashToken(session.token));
      expect(f.store.findSession(hashToken(session.token))).toBeTruthy();
      expect(f.auth.requireSession(session.token)).toMatchObject({ username: 'ops-a' });
    } finally {
      f.cleanup();
    }
  });

  it('rejects an expired server-side session and records a rate-limited failed login', async () => {
    const f = fixture();
    try {
      await expect(
        f.auth.authenticate({ username: 'ops-a', password: 'wrong password', totp: '000000' })
      ).rejects.toThrow('Invalid credentials');
      expect(f.store.listAuditEvents()).toContainEqual(
        expect.objectContaining({ action: 'login_failed' })
      );
      const session = f.auth.createSession(f.store.findAccountByUsername('ops-a')!);
      f.current.setTime(f.current.getTime() + 16 * 60 * 1000);
      expect(() => f.auth.requireSession(session.token)).toThrow('Invalid session');
      await expect(
        f.auth.authenticate({
          username: 'ops-a',
          password: 'correct horse battery staple',
          totp: totpCode(
            'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            Math.floor(f.current.getTime() / 1000 / 30)
          )
        })
      ).resolves.toBeTruthy();
    } finally {
      f.cleanup();
    }
  });

  it('returns the same failure for unknown and invalid users and enforces lockout', async () => {
    const f = fixture();
    try {
      for (let i = 0; i < 5; i++)
        await expect(
          f.auth.authenticate({ username: 'ops-a', password: 'wrong password', totp: '000000' })
        ).rejects.toThrow('Invalid credentials');
      await expect(
        f.auth.authenticate({
          username: 'ops-a',
          password: 'correct horse battery staple',
          totp: '287082'
        })
      ).rejects.toThrow('Invalid credentials');
      await expect(
        f.auth.authenticate({ username: 'unknown', password: 'wrong password', totp: '000000' })
      ).rejects.toThrow('Invalid credentials');
    } finally {
      f.cleanup();
    }
  });

  it('does not let attempts rejected by an existing lock extend the original lock interval', async () => {
    const f = fixture();
    try {
      const initialTime = f.current.getTime();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          f.auth.authenticate({ username: 'ops-a', password: 'wrong password', totp: '000000' })
        ).rejects.toThrow('Invalid credentials');
      }

      f.current.setTime(initialTime + 14 * 60 * 1000);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          f.auth.authenticate({ username: 'ops-a', password: 'wrong password', totp: '000000' })
        ).rejects.toThrow('Invalid credentials');
      }

      f.current.setTime(initialTime + 15 * 60 * 1000 + 1);
      await expect(
        f.auth.authenticate({
          username: 'ops-a',
          password: 'correct horse battery staple',
          totp: totpCode(
            'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            Math.floor(f.current.getTime() / 1000 / 30)
          )
        })
      ).resolves.toMatchObject({ username: 'ops-a' });
    } finally {
      f.cleanup();
    }
  });

  it('supports an offline recovery that rotates credentials and clears lockout state', async () => {
    const f = fixture();
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          f.auth.authenticate({ username: 'ops-a', password: 'wrong password', totp: '000000' })
        ).rejects.toThrow('Invalid credentials');
      }
      const authModule = (await import('./auth.js')) as Record<string, unknown>;
      expect(authModule.recoverAccount).toBeTypeOf('function');
      const recoverAccount = authModule.recoverAccount as (
        store: typeof f.store,
        input: { username: string; password: string; totpSeed: string },
        dataKey: Buffer,
        now: Date
      ) => { enrollmentUri: string };
      const recovered = recoverAccount(
        f.store,
        {
          username: 'ops-a',
          password: 'new correct horse battery staple',
          totpSeed: 'JBSWY3DPEHPK3PXP'
        },
        Buffer.alloc(32, 7),
        f.current
      );

      expect(recovered.enrollmentUri).toContain('otpauth://totp/');
      await expect(
        f.auth.authenticate({
          username: 'ops-a',
          password: 'new correct horse battery staple',
          totp: totpCode('JBSWY3DPEHPK3PXP', Math.floor(f.current.getTime() / 1000 / 30))
        })
      ).resolves.toMatchObject({ username: 'ops-a' });
      expect(f.store.listAuditEvents()).toContainEqual(
        expect.objectContaining({ action: 'account_recovered' })
      );
    } finally {
      f.cleanup();
    }
  });
});
