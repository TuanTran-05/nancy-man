import { randomUUID } from 'node:crypto';

import { verifyTotp as verifyEncryptedTotp } from '../../../../../packages/security/src/mfa/totp.js';
import { verifyPassword as verifyArgonPassword } from '../../../../../packages/security/src/passwords.js';

export type StepUpCapability = 'accounts_write' | 'variables_secret' | 'variables_apply';

export type StepUpGrant = {
  id: string;
  capability: StepUpCapability;
  userId: string;
  sessionId: string;
  ipHash: string;
  userAgentHash: string;
  subjectDigest: string | null;
  grantedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  reusable: boolean;
};

export type StepUpBinding = {
  grantId: string;
  capability: StepUpCapability;
  userId: string;
  sessionId: string;
  ipHash: string;
  userAgentHash: string;
  subjectDigest?: string;
};

export type StepUpRepository = {
  findProof: (input: { userId: string; factorId: string }) => Promise<{
    passwordHash: string;
    encryptedTotpSecret: string;
  } | null>;
  findParentSession?: (input: { userId: string; sessionId: string }) => Promise<{
    absoluteExpiresAt: string;
  } | null>;
  replaceOlder?: (input: {
    userId: string;
    sessionId: string;
    capability: StepUpCapability;
    subjectDigest: string | null;
  }) => Promise<void>;
  insert: (grant: StepUpGrant) => Promise<boolean>;
  authorize: (input: StepUpBinding) => Promise<StepUpGrant | null>;
  consume: (input: StepUpBinding) => Promise<boolean>;
  revoke: (input: StepUpBinding) => Promise<void>;
};

const policies: Readonly<Record<StepUpCapability, { lifetimeMs: number; reusable: boolean }>> = {
  accounts_write: { lifetimeMs: 5 * 60 * 1_000, reusable: false },
  variables_secret: { lifetimeMs: 10 * 60 * 1_000, reusable: true },
  variables_apply: { lifetimeMs: 5 * 60 * 1_000, reusable: false }
};

export class StepUpError extends Error {
  constructor(
    readonly code: 'STEP_UP_REQUIRED' | 'STEP_UP_EXPIRED' | 'STEP_UP_REVOKED' | 'STEP_UP_INVALID'
  ) {
    super(code);
    this.name = 'StepUpError';
  }
}

function assertBinding(input: StepUpBinding): void {
  if (
    !input.grantId ||
    !input.userId ||
    !input.sessionId ||
    !input.ipHash ||
    !input.userAgentHash ||
    !policies[input.capability]
  ) {
    throw new StepUpError('STEP_UP_REQUIRED');
  }
}

export class StepUpService {
  private readonly now: () => Date;
  private readonly issueId: () => string;
  private readonly verifyPassword: (encodedHash: string, password: string) => Promise<boolean>;
  private readonly verifyTotp: (input: {
    encryptedSecret: string;
    encryptionKey: Buffer;
    token: string;
    timestamp: number;
  }) => boolean;

  constructor(
    private readonly input: {
      repository: StepUpRepository;
      encryptionKey?: Buffer;
      now?: () => Date;
      issueId?: () => string;
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
    this.issueId = input.issueId ?? randomUUID;
    this.verifyPassword = input.verifyPassword ?? verifyArgonPassword;
    this.verifyTotp = input.verifyTotp ?? verifyEncryptedTotp;
  }

  async grant(input: {
    capability: StepUpCapability;
    userId: string;
    sessionId: string;
    password: string;
    factorId: string;
    token: string;
    ipHash: string;
    userAgentHash: string;
    subjectDigest?: string;
    parentSessionExpiresAt?: string;
    lifetimeSeconds?: never;
    reusable?: never;
  }): Promise<StepUpGrant> {
    const policy = policies[input.capability];
    if (
      !policy ||
      !input.userId ||
      !input.sessionId ||
      !input.password ||
      !input.factorId ||
      !/^\d{6}$/u.test(input.token) ||
      Object.prototype.hasOwnProperty.call(input, 'lifetimeSeconds') ||
      Object.prototype.hasOwnProperty.call(input, 'reusable')
    ) {
      throw new StepUpError('STEP_UP_INVALID');
    }

    const proof = await this.input.repository.findProof({
      userId: input.userId,
      factorId: input.factorId
    });
    let valid = false;
    if (proof) {
      try {
        valid =
          (await this.verifyPassword(proof.passwordHash, input.password)) &&
          this.verifyTotp({
            encryptedSecret: proof.encryptedTotpSecret,
            encryptionKey: this.input.encryptionKey ?? Buffer.alloc(32),
            token: input.token,
            timestamp: this.now().getTime()
          });
      } catch {
        valid = false;
      }
    }
    if (!valid) throw new StepUpError('STEP_UP_INVALID');

    const grantedAt = this.now();
    let parentExpiry = input.parentSessionExpiresAt;
    if (!parentExpiry && this.input.repository.findParentSession) {
      const parentSession = await this.input.repository.findParentSession({
        userId: input.userId,
        sessionId: input.sessionId
      });
      if (!parentSession) throw new StepUpError('STEP_UP_REQUIRED');
      parentExpiry = parentSession.absoluteExpiresAt;
    }
    const requestedExpiry = grantedAt.getTime() + policy.lifetimeMs;
    const parentExpiryMs = parentExpiry ? Date.parse(parentExpiry) : Number.POSITIVE_INFINITY;
    const expiresAtMs = Math.min(requestedExpiry, parentExpiryMs);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= grantedAt.getTime()) {
      throw new StepUpError('STEP_UP_EXPIRED');
    }
    const subjectDigest = input.subjectDigest ?? null;
    await this.input.repository.replaceOlder?.({
      userId: input.userId,
      sessionId: input.sessionId,
      capability: input.capability,
      subjectDigest
    });
    const grant: StepUpGrant = {
      id: this.issueId(),
      capability: input.capability,
      userId: input.userId,
      sessionId: input.sessionId,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      subjectDigest,
      grantedAt: grantedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      lastUsedAt: null,
      consumedAt: null,
      revokedAt: null,
      reusable: policy.reusable
    };
    if (!(await this.input.repository.insert(grant))) throw new StepUpError('STEP_UP_INVALID');
    return grant;
  }

  async authorize(input: StepUpBinding): Promise<StepUpGrant> {
    assertBinding(input);
    const grant = await this.input.repository.authorize(input);
    if (!grant) throw new StepUpError('STEP_UP_REQUIRED');
    if (grant.revokedAt) throw new StepUpError('STEP_UP_REVOKED');
    if (grant.consumedAt || !grant.reusable) throw new StepUpError('STEP_UP_REQUIRED');
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      throw new StepUpError('STEP_UP_EXPIRED');
    }
    if (
      grant.capability !== input.capability ||
      grant.userId !== input.userId ||
      grant.sessionId !== input.sessionId ||
      grant.ipHash !== input.ipHash ||
      grant.userAgentHash !== input.userAgentHash ||
      (grant.subjectDigest ?? undefined) !== input.subjectDigest
    ) {
      throw new StepUpError('STEP_UP_REQUIRED');
    }
    return grant;
  }

  async consume(input: StepUpBinding): Promise<boolean> {
    assertBinding(input);
    return this.input.repository.consume(input);
  }

  async revoke(input: StepUpBinding): Promise<void> {
    assertBinding(input);
    await this.input.repository.revoke(input);
  }
}
