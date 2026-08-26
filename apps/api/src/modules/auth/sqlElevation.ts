import { randomUUID } from 'node:crypto';

import { verifyTotp as verifyEncryptedTotp } from '../../../../../packages/security/src/mfa/totp.js';

type ElevationRepository = {
  findActiveTotpFactor: (input: {
    userId: string;
    factorId: string;
  }) => Promise<{ encryptedSecret: string } | null>;
  grant: (input: {
    id: string;
    userId: string;
    sessionId: string;
    factorId: string;
    reason: string;
    grantedAt: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  }) => Promise<boolean>;
};

export class SqlElevationService {
  private readonly now: () => Date;
  private readonly issueId: () => string;
  private readonly verifyTotp: (input: {
    encryptedSecret: string;
    encryptionKey: Buffer;
    token: string;
    timestamp: number;
  }) => boolean;

  constructor(
    private readonly input: {
      repository: ElevationRepository;
      encryptionKey: Buffer;
      now?: () => Date;
      issueId?: () => string;
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
    this.verifyTotp = input.verifyTotp ?? verifyEncryptedTotp;
  }

  async grant(input: {
    userId: string;
    sessionId: string;
    factorId: string;
    token: string;
    reason: string;
  }): Promise<
    { status: 'denied' } | { status: 'granted'; idleExpiresAt: string; absoluteExpiresAt: string }
  > {
    const reason = input.reason.trim();
    if (
      reason.length < 3 ||
      reason.length > 250 ||
      !/^\d{6}$/.test(input.token) ||
      !input.userId ||
      !input.sessionId ||
      !input.factorId
    ) {
      return { status: 'denied' };
    }
    const factor = await this.input.repository.findActiveTotpFactor({
      userId: input.userId,
      factorId: input.factorId
    });
    const now = this.now();
    if (
      !factor ||
      !this.verifyTotp({
        encryptedSecret: factor.encryptedSecret,
        encryptionKey: this.input.encryptionKey,
        token: input.token,
        timestamp: now.getTime()
      })
    ) {
      return { status: 'denied' };
    }
    const grantedAt = now.toISOString();
    const idleExpiresAt = new Date(now.getTime() + 15 * 60 * 1_000).toISOString();
    const absoluteExpiresAt = new Date(now.getTime() + 30 * 60 * 1_000).toISOString();
    const granted = await this.input.repository.grant({
      id: this.issueId(),
      userId: input.userId,
      sessionId: input.sessionId,
      factorId: input.factorId,
      reason,
      grantedAt,
      idleExpiresAt,
      absoluteExpiresAt
    });
    if (!granted) return { status: 'denied' };
    return { status: 'granted', idleExpiresAt, absoluteExpiresAt };
  }
}
