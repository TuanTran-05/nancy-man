import { z } from 'zod';
import type { ZaloBotConfig } from './config.js';

export type ZaloBotApiErrorKind =
  | 'invalid_chat'
  | 'auth'
  | 'rate_limited'
  | 'transient'
  | 'permanent';

export class ZaloBotApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ZaloBotApiErrorKind,
    public readonly statusCode: number,
    public readonly retryAfterMs = 0,
    public readonly deliveryAmbiguous = false,
    public readonly providerErrorCode?: number
  ) {
    super(message);
    this.name = 'ZaloBotApiError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'transient' || this.kind === 'auth';
  }

  get abortBatch(): boolean {
    return this.kind === 'auth';
  }
}

const responseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.string().min(1) }).optional(),
  description: z.string().optional(),
  error_code: z.number().int().optional(),
});

export async function sendZaloBotText(
  input: { chatId: string; text: string },
  config: Pick<ZaloBotConfig, 'token' | 'requestTimeoutMs'>
): Promise<{ messageId: string }> {
  if (!input.text || input.text.length === 0 || input.text.length > 2000) {
    throw new ZaloBotApiError('Text must be between 1 and 2000 characters', 'permanent', 400);
  }

  const url = `https://bot-api.zaloplatforms.com/bot${config.token}/sendMessage`;

  try {
    const signal = AbortSignal.timeout(config.requestTimeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
      }),
      signal,
    });

    let envelope;
    try {
      envelope = responseSchema.parse(await response.json());
    } catch (e) {
      if (response.status >= 500) {
        throw new ZaloBotApiError('Zalo Bot API unavailable', 'transient', response.status);
      } else if (response.status === 429) {
        let retryAfterMs = 5000;
        const retryHeader = response.headers.get('Retry-After');
        if (retryHeader) {
          const parsed = parseInt(retryHeader, 10);
          if (!isNaN(parsed)) {
            retryAfterMs = Math.max(5000, Math.min(300000, parsed * 1000));
          }
        }
        throw new ZaloBotApiError('Zalo Bot API rate limited', 'rate_limited', 429, retryAfterMs);
      }
      throw new ZaloBotApiError(
        'Zalo Bot API response parsing failed',
        'permanent',
        response.status
      );
    }

    if (!envelope.ok) {
      const code = envelope.error_code ?? response.status;
      const desc = envelope.description || '';

      let kind: ZaloBotApiErrorKind = 'permanent';
      let retryMs = 0;

      if (code === 401) {
        kind = 'auth';
      } else if (code === 403 || code === 408 || (code >= 500 && code < 600)) {
        kind = 'transient';
      } else if (code === 429) {
        kind = 'rate_limited';
        let retryAfterMs = 5000;
        const retryHeader = response.headers.get('Retry-After');
        if (retryHeader) {
          const parsed = parseInt(retryHeader, 10);
          if (!isNaN(parsed)) {
            retryAfterMs = Math.max(5000, Math.min(300000, parsed * 1000));
          }
        }
        retryMs = retryAfterMs;
      } else if (code === 400 || code === 404) {
        const lowerDesc = desc.toLowerCase();
        const hasChatSubject =
          lowerDesc.includes('chat') ||
          lowerDesc.includes('recipient') ||
          lowerDesc.includes('người nhận') ||
          lowerDesc.includes('cuộc trò chuyện');
        const hasInvalidState =
          lowerDesc.includes('invalid') ||
          lowerDesc.includes('not found') ||
          lowerDesc.includes('không hợp lệ') ||
          lowerDesc.includes('không tồn tại');
        if (hasChatSubject && hasInvalidState) {
          kind = 'invalid_chat';
        } else {
          kind = 'permanent';
        }
      }

      throw new ZaloBotApiError(
        `Zalo Bot sendMessage failed with provider code ${code}`,
        kind,
        response.status,
        retryMs,
        false,
        code
      );
    }

    if (!envelope.result?.message_id) {
      throw new ZaloBotApiError(
        'Zalo Bot API response missing message_id',
        'permanent',
        response.status
      );
    }

    return { messageId: envelope.result.message_id };
  } catch (err: unknown) {
    if (err instanceof ZaloBotApiError) {
      throw err;
    }

    throw new ZaloBotApiError('Zalo Bot network error', 'transient', 0, 0, true);
  }
}
