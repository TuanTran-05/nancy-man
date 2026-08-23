import { createHmac, randomBytes } from 'node:crypto';

const LINK_COMMAND = /^\/link\s+([a-z0-9-]{6,16})$/iu;

export function parseOpsZaloLinkCommand(text: string): string | null {
  const match = LINK_COMMAND.exec(text.trim());
  return match ? match[1].replace(/-/g, '').toUpperCase() : null;
}

export function createOpsZaloLinkCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function hashZaloLinkCode(code: string, pepper: string): string {
  return hmac(pepper, `ops-link-code:${code}`);
}

export function hashZaloChatId(chatId: string, secret: string): string {
  return hmac(secret, `ops-chat-id:${chatId}`);
}

export function isValidOpsZaloSecret(value: string): boolean {
  return value.length >= 32 && value.length <= 256;
}
