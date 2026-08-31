import { createHash, randomUUID } from 'node:crypto';
import {
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotp
} from '../../../../../packages/security/src/mfa/totp.js';
import {
  hashPassword,
  passwordFingerprint,
  validatePasswordPolicy
} from '../../../../../packages/security/src/passwords.js';

type PendingFactor = string | { encryptedSecret: string };

export class TotpEnrollmentService {
  constructor(
    private readonly input: {
      encryptionKey: Buffer;
      repository: {
        createPendingFactor: (input: {
          userId: string;
          tokenHash: string;
          factorId: string;
          encryptedSecret: string;
        }) => Promise<boolean>;
        findPendingFactor: (input: {
          userId: string;
          tokenHash: string;
          factorId: string;
        }) => Promise<PendingFactor | null>;
        activate: (input: {
          userId: string;
          tokenHash: string;
          factorId: string;
          passwordHash: string;
          passwordFingerprint: string;
        }) => Promise<boolean>;
      };
      passwordFingerprintPepper: string;
      hashPassword?: (password: string) => Promise<string>;
      passwordFingerprint?: (password: string, pepper: string) => string;
      validatePasswordPolicy?: (input: { password: string }) => void;
      now?: () => Date;
    }
  ) {}
  async start(input: {
    userId: string;
    token: string;
  }): Promise<{ factorId: string; secret: string; otpauthUri: string } | null> {
    const secret = generateTotpSecret();
    const factorId = randomUUID();
    const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');
    const created = await this.input.repository.createPendingFactor({
      userId: input.userId,
      tokenHash,
      factorId,
      encryptedSecret: encryptTotpSecret(secret, this.input.encryptionKey)
    });
    return created
      ? {
          factorId,
          secret,
          otpauthUri: `otpauth://totp/EduTrack%20Operations:${encodeURIComponent(input.userId)}?secret=${secret}&issuer=EduTrack%20Operations`
        }
      : null;
  }
  async verify(input: {
    userId: string;
    token: string;
    factorId: string;
    otp: string;
    password: string;
  }): Promise<boolean> {
    if (!input.password || !this.input.passwordFingerprintPepper) return false;
    try {
      (this.input.validatePasswordPolicy ?? validatePasswordPolicy)({ password: input.password });
    } catch {
      return false;
    }
    const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');
    const pending = await this.input.repository.findPendingFactor({
      userId: input.userId,
      tokenHash,
      factorId: input.factorId
    });
    const encryptedSecret = typeof pending === 'string' ? pending : pending?.encryptedSecret;
    if (
      !encryptedSecret ||
      !verifyTotp({
        encryptedSecret,
        encryptionKey: this.input.encryptionKey,
        token: input.otp,
        ...(this.input.now ? { timestamp: this.input.now().getTime() } : {})
      })
    )
      return false;
    let passwordHash: string;
    try {
      passwordHash = await (this.input.hashPassword ?? hashPassword)(input.password);
    } catch {
      return false;
    }
    const fingerprint = (this.input.passwordFingerprint ?? passwordFingerprint)(
      input.password,
      this.input.passwordFingerprintPepper
    );
    return this.input.repository.activate({
      userId: input.userId,
      tokenHash,
      factorId: input.factorId,
      passwordHash,
      passwordFingerprint: fingerprint
    });
  }
}
