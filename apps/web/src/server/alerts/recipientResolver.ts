import { decryptSecret } from '../security/crypto.js';
import type { OpsStore } from '../storage/store.js';

export function resolveZaloRecipients(
  store: OpsStore,
  recipientKey: Buffer,
  configured: string[] = []
): string[] {
  const recipients = [...configured];
  for (const ciphertext of store.listActiveZaloRecipientCiphertexts()) {
    try {
      const recipient = decryptSecret(ciphertext, recipientKey);
      if (recipient && /^[A-Za-z0-9_.:-]{1,128}$/.test(recipient)) recipients.push(recipient);
    } catch {
      // A corrupt or mismatched ciphertext must fail closed for this recipient.
    }
  }
  return [...new Set(recipients)];
}
