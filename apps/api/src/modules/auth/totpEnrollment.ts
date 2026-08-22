import { createHash, randomUUID } from 'node:crypto';
import {
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotp
} from '../../../../../packages/security/src/mfa/totp.js';

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
        }) => Promise<string | null>;
        activate: (input: {
          userId: string;
          tokenHash: string;
          factorId: string;
        }) => Promise<boolean>;
      };
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
  }): Promise<boolean> {
    const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');
    const encryptedSecret = await this.input.repository.findPendingFactor({
      userId: input.userId,
      tokenHash,
      factorId: input.factorId
    });
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
    return this.input.repository.activate({
      userId: input.userId,
      tokenHash,
      factorId: input.factorId
    });
  }
}
