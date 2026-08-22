import { createHash, randomUUID } from 'node:crypto';

import {
  createCsrfToken,
  deriveCsrfSecret,
  hashCsrfSecret,
  hashSessionToken,
  issueSession,
  type OpsRole
} from '../../../../../packages/security/src/sessions.js';
import { verifyTotp as verifyEncryptedTotp } from '../../../../../packages/security/src/mfa/totp.js';
import { verifyPassword as verifyArgonPassword } from '../../../../../packages/security/src/passwords.js';

export type MfaFactorSummary = {
  id: string;
  type: 'totp';
  label: string;
};

export type PasswordCredential = {
  id: string;
  username: string;
  displayName: string;
  role: OpsRole;
  status: 'pending_mfa' | 'active' | 'locked' | 'revoked';
  passwordHash: string;
  mfaFactors: readonly MfaFactorSummary[];
};

export type TotpChallenge = {
  id: string;
  userId: string;
  role: OpsRole;
  encryptedTotpSecret: string;
};

export type OpsAuthRepository = {
  findPasswordCredential: (identifier: string) => Promise<PasswordCredential | null>;
  recordLoginEvent: (input: {
    userId?: string;
    outcome: 'succeeded' | 'failed';
    ipHash: string;
    userAgent: string;
    reasonCode: string;
  }) => Promise<void>;
  createMfaChallenge: (input: {
    id: string;
    userId: string;
    challengeHash: string;
    expiresAt: string;
    ipHash: string;
    userAgent: string;
  }) => Promise<void>;
  findTotpChallenge: (input: {
    challengeHash: string;
    factorId: string;
    ipHash: string;
  }) => Promise<TotpChallenge | null>;
  consumeMfaChallengeAndCreateSession: (input: {
    challengeHash: string;
    sessionId: string;
    userId: string;
    sessionHash: string;
    csrfSecretHash: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
    ipHash: string;
    userAgent: string;
    loginEventId: string;
  }) => Promise<boolean>;
};

function hashMfaChallenge(token: string, pepper: string): string {
  return createHash('sha256').update(`ops-mfa-login-v1:${token}:${pepper}`, 'utf8').digest('hex');
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function safeUserAgent(userAgent: string): string {
  return userAgent.trim().slice(0, 512) || 'unknown';
}

type IssuedSession = ReturnType<typeof issueSession>;

export class OpsAuthService {
  private readonly now: () => Date;
  private readonly issueOpaqueToken: () => string;
  private readonly issueSessionId: () => string;
  private readonly verifyPassword: (encodedHash: string, password: string) => Promise<boolean>;
  private readonly verifyTotp: (input: {
    encryptedSecret: string;
    encryptionKey: Buffer;
    token: string;
    timestamp: number;
  }) => boolean;

  constructor(
    private readonly input: {
      repository: OpsAuthRepository;
      sessionPepper: string;
      mfaEncryptionKey: Buffer;
      now?: () => Date;
      issueOpaqueToken?: () => string;
      issueSessionId?: () => string;
      verifyPassword?: (encodedHash: string, password: string) => Promise<boolean>;
      verifyTotp?: (input: {
        encryptedSecret: string;
        encryptionKey: Buffer;
        token: string;
        timestamp: number;
      }) => boolean;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.issueOpaqueToken =
      input.issueOpaqueToken ??
      (() => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''));
    this.issueSessionId = input.issueSessionId ?? randomUUID;
    this.verifyPassword = input.verifyPassword ?? verifyArgonPassword;
    this.verifyTotp = input.verifyTotp ?? verifyEncryptedTotp;
  }

  async beginLogin(input: {
    identifier: string;
    password: string;
    ipHash: string;
    userAgent: string;
  }): Promise<
    | { status: 'denied' }
    | { status: 'mfa_required'; mfaChallenge: string; factors: readonly MfaFactorSummary[] }
  > {
    const principal = await this.input.repository.findPasswordCredential(
      normalizeIdentifier(input.identifier)
    );
    const userAgent = safeUserAgent(input.userAgent);
    if (
      !principal ||
      principal.status !== 'active' ||
      !(await this.verifyPassword(principal.passwordHash, input.password)) ||
      principal.mfaFactors.length === 0
    ) {
      await this.input.repository.recordLoginEvent({
        ...(principal ? { userId: principal.id } : {}),
        outcome: 'failed',
        ipHash: input.ipHash,
        userAgent,
        reasonCode: 'INVALID_CREDENTIALS_OR_MFA_UNAVAILABLE'
      });
      return { status: 'denied' };
    }

    const mfaChallenge = this.issueOpaqueToken();
    const now = this.now();
    await this.input.repository.createMfaChallenge({
      id: randomUUID(),
      userId: principal.id,
      challengeHash: hashMfaChallenge(mfaChallenge, this.input.sessionPepper),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
      ipHash: input.ipHash,
      userAgent
    });
    return { status: 'mfa_required', mfaChallenge, factors: principal.mfaFactors };
  }

  async completeTotpLogin(input: {
    mfaChallenge: string;
    factorId: string;
    token: string;
    ipHash: string;
    userAgent: string;
  }): Promise<
    | { status: 'denied' }
    | {
        status: 'authenticated';
        sessionToken: string;
        csrfToken: string;
        role: OpsRole;
        idleExpiresAt: string;
        absoluteExpiresAt: string;
      }
  > {
    const challengeHash = hashMfaChallenge(input.mfaChallenge, this.input.sessionPepper);
    const userAgent = safeUserAgent(input.userAgent);
    const challenge = await this.input.repository.findTotpChallenge({
      challengeHash,
      factorId: input.factorId,
      ipHash: input.ipHash
    });
    if (
      !challenge ||
      !this.verifyTotp({
        encryptedSecret: challenge.encryptedTotpSecret,
        encryptionKey: this.input.mfaEncryptionKey,
        token: input.token,
        timestamp: this.now().getTime()
      })
    ) {
      await this.input.repository.recordLoginEvent({
        ...(challenge ? { userId: challenge.userId } : {}),
        outcome: 'failed',
        ipHash: input.ipHash,
        userAgent,
        reasonCode: 'INVALID_MFA'
      });
      return { status: 'denied' };
    }

    const session = this.createSession();
    const csrfSecret = deriveCsrfSecret({
      sessionToken: session.token,
      csrfPepper: this.input.sessionPepper
    });
    const sessionId = this.issueSessionId();
    const authenticated = await this.input.repository.consumeMfaChallengeAndCreateSession({
      challengeHash,
      sessionId,
      userId: challenge.userId,
      sessionHash: hashSessionToken(session.token, this.input.sessionPepper),
      csrfSecretHash: hashCsrfSecret(csrfSecret),
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      ipHash: input.ipHash,
      userAgent,
      loginEventId: randomUUID()
    });
    if (!authenticated) return { status: 'denied' };

    return {
      status: 'authenticated',
      sessionToken: session.token,
      csrfToken: createCsrfToken({ sessionId, csrfSecret }),
      role: challenge.role,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt
    };
  }

  private createSession(): IssuedSession {
    const now = this.now();
    const token = this.issueOpaqueToken();
    return {
      token,
      csrfSecret: '',
      idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000).toISOString(),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000).toISOString()
    };
  }
}
