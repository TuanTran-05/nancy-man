import type {
  SqlConfirmationReceipt,
  SqlRisk
} from '../../../../../packages/contracts/src/sqlRisk.js';
import { confirmationPhrase } from '../../../../../packages/contracts/src/sqlRisk.js';

const confirmationLifetimeMs = 5 * 60 * 1_000;

function normalizedPhrase(value: string): string {
  return value.normalize('NFKC');
}

export function createConfirmationReceipt(input: {
  executionKey: string;
  previewChecksum: string;
  userId: string;
  sessionId: string;
  risk: SqlRisk;
  issuedAt: Date;
}): SqlConfirmationReceipt {
  return {
    executionKey: input.executionKey,
    previewChecksum: input.previewChecksum,
    userId: input.userId,
    sessionId: input.sessionId,
    phrase: confirmationPhrase({ executionKey: input.executionKey, risk: input.risk }),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: new Date(input.issuedAt.getTime() + confirmationLifetimeMs).toISOString()
  };
}

export function verifyConfirmationReceipt(input: {
  receipt: SqlConfirmationReceipt;
  executionKey: string;
  previewChecksum: string;
  userId: string;
  sessionId: string;
  phrase: string;
  now: Date;
}): { accepted: true } | { accepted: false; code: 'SQL_CONFIRMATION_INVALID' } {
  const sameReceipt =
    input.receipt.executionKey === input.executionKey &&
    input.receipt.previewChecksum === input.previewChecksum &&
    input.receipt.userId === input.userId &&
    input.receipt.sessionId === input.sessionId;
  const expiresAt = Date.parse(input.receipt.expiresAt);
  const validExpiry = Number.isFinite(expiresAt) && input.now.getTime() < expiresAt;
  const exactPhrase = normalizedPhrase(input.phrase) === normalizedPhrase(input.receipt.phrase);

  if (!sameReceipt || !validExpiry || !exactPhrase) {
    return { accepted: false, code: 'SQL_CONFIRMATION_INVALID' };
  }
  return { accepted: true };
}
