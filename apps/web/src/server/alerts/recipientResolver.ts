import { encryptSecret } from '../security/crypto.js';
import type { OpsStore } from '../storage/store.js';

export function resolveZaloRecipientCiphertexts(
  store: OpsStore,
  recipientKey: Buffer,
  configured: string[] = []
): string[] {
  const configuredCiphertexts = [...new Set(configured)].map((recipient) =>
    encryptSecret(recipient, recipientKey)
  );
  return [...configuredCiphertexts, ...store.listActiveZaloRecipientCiphertexts()];
}
