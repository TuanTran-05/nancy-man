import { randomUUID } from 'node:crypto';
import type { OpsStore, AccountRecord } from '../storage/store.js';
import {
  decryptSecret,
  encryptSecret,
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword
} from './crypto.js';
import { enrollmentUri, verifyTotp } from './totp.js';

const IDLE_MS = 15 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export interface AuthSession {
  token: string;
  csrfToken: string;
  accountId: string;
  username: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface RequiredSession {
  accountId: string;
  username: string;
  tokenHash: string;
  csrfToken: string;
  csrfTokenHash: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface ProvisionedAccount {
  account: AccountRecord;
  enrollmentUri: string;
}

interface AuthDependencies {
  store: OpsStore;
  dataKey: Buffer;
  now?: () => Date;
}

export function provisionAccount(
  store: OpsStore,
  input: { username: string; password: string; totpSeed: string },
  dataKey: Buffer,
  now: Date = new Date()
): ProvisionedAccount {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username))
    throw new Error('Username must contain only safe characters');
  if (store.findAccountByUsername(username)) throw new Error('Username already exists');
  const id = randomUUID();
  const createdAt = now.toISOString();
  const passwordHash = hashPassword(input.password);
  const totpSecretEnc = encryptSecret(input.totpSeed, dataKey);
  store.createAccount({ id, username, passwordHash, totpSecretEnc, createdAt });
  store.recordAuditEvent({
    actorId: null,
    action: 'account_provisioned',
    target: id,
    details: { username },
    occurredAt: createdAt
  });
  return {
    account: { id, username, passwordHash, totpSecretEnc, createdAt, disabledAt: null },
    enrollmentUri: enrollmentUri(username, input.totpSeed)
  };
}

export function recoverAccount(
  store: OpsStore,
  input: { username: string; password: string; totpSeed: string },
  dataKey: Buffer,
  now: Date = new Date()
): ProvisionedAccount {
  const username = input.username.trim();
  const account = store.findAccountByUsername(username);
  if (!account) throw new Error('Account not found');
  const passwordHash = hashPassword(input.password);
  const totpSecretEnc = encryptSecret(input.totpSeed, dataKey);
  store.recoverAccountCredentials({
    accountId: account.id,
    username,
    passwordHash,
    totpSecretEnc
  });
  store.recordAuditEvent({
    actorId: null,
    action: 'account_recovered',
    target: account.id,
    details: { username },
    occurredAt: now.toISOString()
  });
  return {
    account: { ...account, passwordHash, totpSecretEnc, disabledAt: null },
    enrollmentUri: enrollmentUri(username, input.totpSeed)
  };
}

export function createAuthService(deps: AuthDependencies) {
  const now = deps.now ?? (() => new Date());

  function createSession(account: Pick<AccountRecord, 'id' | 'username'>): AuthSession {
    const created = now();
    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const createdAt = created.toISOString();
    const expiresAt = new Date(created.getTime() + IDLE_MS).toISOString();
    const absoluteExpiresAt = new Date(created.getTime() + ABSOLUTE_MS).toISOString();
    deps.store.createSession({
      tokenHash: hashToken(token),
      accountId: account.id,
      csrfToken,
      csrfTokenHash: hashToken(csrfToken),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      absoluteExpiresAt
    });
    return {
      token,
      csrfToken,
      accountId: account.id,
      username: account.username,
      expiresAt,
      absoluteExpiresAt
    };
  }

  async function authenticate(input: {
    username: string;
    password: string;
    totp: string;
  }): Promise<AuthSession> {
    const attemptedAt = now();
    const username = input.username.trim();
    const account = deps.store.findAccountByUsername(username);
    const lockoutSince = new Date(attemptedAt.getTime() - LOCKOUT_MS).toISOString();
    const locked = deps.store.countRecentFailedLogins(username, lockoutSince) >= MAX_FAILED;
    let valid = !locked && Boolean(account && !account.disabledAt);
    if (valid && account) {
      valid = verifyPassword(input.password, account.passwordHash);
      if (valid) {
        try {
          const seed = decryptSecret(account.totpSecretEnc, deps.dataKey);
          valid = verifyTotp(seed, input.totp, attemptedAt);
        } catch {
          valid = false;
        }
      }
    }
    if (!locked)
      deps.store.recordLoginAttempt({
        username,
        attemptedAt: attemptedAt.toISOString(),
        success: valid
      });
    if (!valid || !account) {
      deps.store.recordAuditEvent({
        actorId: account?.id ?? null,
        action: 'login_failed',
        target: username.slice(0, 64),
        details: { reason: 'invalid_credentials' },
        occurredAt: attemptedAt.toISOString()
      });
      throw new InvalidCredentialsError();
    }
    deps.store.recordAuditEvent({
      actorId: account.id,
      action: 'login_succeeded',
      target: account.id,
      details: {},
      occurredAt: attemptedAt.toISOString()
    });
    return createSession(account);
  }

  function requireSession(token: string): RequiredSession {
    const tokenHash = hashToken(token);
    const session = deps.store.findSession(tokenHash);
    const current = now();
    if (
      !session ||
      Date.parse(session.expiresAt) <= current.getTime() ||
      Date.parse(session.absoluteExpiresAt) <= current.getTime()
    ) {
      if (session) deps.store.deleteSession(tokenHash);
      throw new Error('Invalid session');
    }
    const account = deps.store.findAccountById(session.accountId);
    if (!account || account.disabledAt) {
      deps.store.deleteSession(tokenHash);
      throw new Error('Invalid session');
    }
    const expiresAt = new Date(
      Math.min(current.getTime() + IDLE_MS, Date.parse(session.absoluteExpiresAt))
    ).toISOString();
    deps.store.touchSession(tokenHash, current.toISOString(), expiresAt);
    return {
      accountId: session.accountId,
      username: session.username,
      tokenHash,
      csrfToken: session.csrfToken,
      csrfTokenHash: session.csrfTokenHash,
      expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt
    };
  }

  function destroySession(token: string): void {
    deps.store.deleteSession(hashToken(token));
  }

  function verifySessionCsrf(session: RequiredSession, csrfToken: string): boolean {
    return hashToken(csrfToken) === session.csrfTokenHash;
  }

  return { authenticate, createSession, requireSession, destroySession, verifySessionCsrf };
}

export const createSession = (
  service: ReturnType<typeof createAuthService>,
  account: Pick<AccountRecord, 'id' | 'username'>
) => service.createSession(account);
export const authenticate = (
  service: ReturnType<typeof createAuthService>,
  input: { username: string; password: string; totp: string }
) => service.authenticate(input);
export const requireSession = (service: ReturnType<typeof createAuthService>, token: string) =>
  service.requireSession(token);
export const destroySession = (service: ReturnType<typeof createAuthService>, token: string) =>
  service.destroySession(token);
