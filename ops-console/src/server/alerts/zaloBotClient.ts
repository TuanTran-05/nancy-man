import { z } from 'zod';

const responseSchema = z.object({ ok: z.boolean(), result: z.object({ message_id: z.union([z.string(), z.number()]) }).optional(), error_code: z.union([z.string(), z.number()]).optional(), description: z.string().optional() }).passthrough();

export class ZaloDeliveryError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly ambiguous = false) {
    super(code);
    this.name = 'ZaloDeliveryError';
  }
}

export interface ZaloSendConfig {
  botToken: string;
  recipientId: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function sendZaloText(config: ZaloSendConfig, text: string): Promise<{ messageId: string }> {
  if (!config.botToken || !config.recipientId) throw new ZaloDeliveryError('invalid_configuration', false);
  if (text.length < 1 || text.length > 2000) throw new ZaloDeliveryError('message_length_invalid', false);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(`https://bot-api.zaloplatforms.com/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.recipientId, text }),
        signal: controller.signal,
      });
    } catch {
      throw new ZaloDeliveryError('delivery_ambiguous', true, true);
    }
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    if (response.status === 401) throw new ZaloDeliveryError('provider_auth_failed', false);
    const parsed = responseSchema.safeParse(body);
    if (!response.ok) {
      const errorCode = parsed.success ? String(parsed.data.error_code ?? '') : '';
      if (/invalid[_ -]?recipient|chat[_ -]?not[_ -]?found/iu.test(errorCode)) throw new ZaloDeliveryError('invalid_recipient', false);
      if ([403, 408, 429].includes(response.status) || response.status >= 500) throw new ZaloDeliveryError(`provider_http_${response.status}`, true);
      throw new ZaloDeliveryError(`provider_http_${response.status}`, false);
    }
    if (!parsed.success || !parsed.data.ok || !parsed.data.result) {
      const errorCode = parsed.success ? String(parsed.data.error_code ?? '') : 'invalid_provider_response';
      if (/invalid[_ -]?recipient|chat[_ -]?not[_ -]?found/iu.test(errorCode)) throw new ZaloDeliveryError('invalid_recipient', false);
      throw new ZaloDeliveryError('provider_invalid_response', false);
    }
    return { messageId: String(parsed.data.result.message_id) };
  } finally {
    clearTimeout(timeout);
  }
}
