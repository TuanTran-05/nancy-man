import { encryptSecret } from '../security/crypto.js';
import { hashZaloChatId } from '../security/zaloLink.js';
import type { OpsStore, ZaloRecipientRecord } from '../storage/store.js';

export function resolveZaloRecipients(
  store: OpsStore,
  recipientKey: Buffer,
  chatHashSecret: string,
  configured: string[] = []
): ZaloRecipientRecord[] {
  const recipients = new Map<string, ZaloRecipientRecord>();
  for (const recipient of configured) {
    const recipientHash = hashZaloChatId(recipient, chatHashSecret);
    if (!recipients.has(recipientHash))
      recipients.set(recipientHash, {
        recipientHash,
        recipientCiphertext: encryptSecret(recipient, recipientKey)
      });
  }
  for (const recipient of store.listActiveZaloRecipients())
    if (!recipients.has(recipient.recipientHash))
      recipients.set(recipient.recipientHash, recipient);
  return [...recipients.values()];
}
