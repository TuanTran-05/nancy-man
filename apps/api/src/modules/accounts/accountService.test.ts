import { describe, expect, it } from 'vitest';

import { AccountService, type AccountRepository } from './accountService.js';

const owner = {
  id: 'owner-id',
  username: 'tuan.dev',
  email: 'owner@example.test',
  displayName: 'Tuan Dev',
  role: 'ops_owner' as const,
  status: 'active' as const,
  mfaEnrolled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: null
};
const maintainer = {
  ...owner,
  id: 'maintainer-id',
  username: 'ops-admin',
  email: 'admin@example.test',
  displayName: 'Ops Admin',
  role: 'ops_maintainer' as const
};

function repository(): AccountRepository & { accounts: Map<string, typeof owner> } {
  const accounts = new Map<string, typeof owner>([
    [owner.id, owner],
    [maintainer.id, maintainer]
  ]);
  return {
    accounts,
    list: async () => [...accounts.values()],
    findById: async (id) => accounts.get(id) ?? null,
    countActiveOwners: async () => [...accounts.values()].filter((item) => item.role === 'ops_owner' && item.status === 'active').length,
    createPending: async (input) => {
      const account = {
        id: input.id,
        username: input.username,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        status: 'pending_mfa' as const,
        mfaEnrolled: false,
        createdAt: input.createdAt,
        lastLoginAt: null
      };
      accounts.set(account.id, account);
      return true;
    },
    changeRole: async ({ targetUserId, role }) => {
      const account = accounts.get(targetUserId);
      if (account) account.role = role;
      return Boolean(account);
    },
    lock: async ({ targetUserId }) => {
      const account = accounts.get(targetUserId);
      if (account) account.status = 'locked';
      return Boolean(account);
    },
    recover: async ({ targetUserId }) => {
      const account = accounts.get(targetUserId);
      if (account) account.status = 'pending_mfa';
      return Boolean(account);
    },
    revoke: async ({ targetUserId }) => {
      const account = accounts.get(targetUserId);
      if (account) account.status = 'revoked';
      return Boolean(account);
    }
  };
}

const grant = {
  grantId: 'accounts-grant',
  capability: 'accounts_write' as const,
  userId: owner.id,
  sessionId: 'session-id',
  ipHash: 'a'.repeat(64),
  userAgentHash: 'b'.repeat(64)
};

function serviceWith(repositoryValue: AccountRepository) {
  const consumed: unknown[] = [];
  const audited: unknown[] = [];
  return {
    service: new AccountService({
      repository: repositoryValue,
      stepUp: { consume: async (input) => (consumed.push(input), true) },
      audit: { append: async (input) => (audited.push(input), { id: 'audit-id', entryHash: 'hash' }) },
      now: () => new Date('2026-08-31T12:00:00.000Z'),
      issueId: () => 'new-user-id',
      enrollmentToken: () => ({ plainToken: 'plain-enrollment-token', tokenHash: 'token-hash' })
    }),
    consumed,
    audited
  };
}

describe('AccountService', () => {
  it.each(['changeRole', 'lock', 'revoke'] as const)('rejects %s against the acting owner', async (operation) => {
    const value = serviceWith(repository());
    await expect(
      value.service[operation]({
        actorUserId: owner.id,
        targetUserId: owner.id,
        ...(operation === 'changeRole' ? { role: 'ops_viewer' as const } : {}),
        ...(operation === 'revoke' ? { confirmationUsername: owner.username } : {}),
        authorization: grant
      } as never)
    ).rejects.toThrow('ACCOUNT_SELF_PROTECTED');
    expect(value.consumed).toHaveLength(0);
  });

  it('creates a maintainer by default and returns a one-time 24-hour enrollment link', async () => {
    const value = serviceWith(repository());
    await expect(
      value.service.create({
        ...grant,
        actorUserId: owner.id,
        username: 'new.operator',
        email: 'new@example.test',
        displayName: 'New Operator'
      })
    ).resolves.toEqual({
      userId: 'new-user-id',
      enrollmentUrl: 'https://ops.example.test/bootstrap/mfa?token=plain-enrollment-token',
      expiresAt: '2026-09-01T12:00:00.000Z'
    });
    expect(JSON.stringify(value.audited)).not.toContain('plain-enrollment-token');
  });

  it('requires exact username confirmation for terminal revoke', async () => {
    const value = serviceWith(repository());
    await expect(
      value.service.revoke({
        ...grant,
        targetUserId: maintainer.id,
        confirmationUsername: 'wrong-name'
      })
    ).rejects.toThrow('ACCOUNT_USERNAME_CONFIRMATION_REQUIRED');
  });

  it('protects the final active owner from demotion', async () => {
    const value = serviceWith(repository());
    await expect(
      value.service.changeRole({
        ...grant,
        actorUserId: owner.id,
        targetUserId: owner.id,
        role: 'ops_viewer'
      })
    ).rejects.toThrow('ACCOUNT_SELF_PROTECTED');
  });
});
