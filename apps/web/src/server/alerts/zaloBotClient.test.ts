import { describe, expect, it } from 'vitest';
import { sendZaloText, ZaloDeliveryError } from './zaloBotClient.js';

describe('Zalo Bot client', () => {
  it('sends the fixed Bot API envelope and validates message id', async () => {
    let request: RequestInit | undefined;
    const result = await sendZaloText(
      {
        botToken: 'bot-secret',
        recipientId: 'ops-a',
        timeoutMs: 5000,
        fetchImpl: async (_url, init) => {
          request = init;
          return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
            status: 200
          });
        }
      },
      'CRITICAL: safe alert'
    );
    expect(result).toEqual({ messageId: '42' });
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual({
      chat_id: 'ops-a',
      text: 'CRITICAL: safe alert'
    });
  });

  it('maps provider, invalid recipient and network failures without leaking response text', async () => {
    await expect(
      sendZaloText(
        {
          botToken: 'x',
          recipientId: 'ops-a',
          timeoutMs: 5000,
          fetchImpl: async () => new Response('{}', { status: 401 })
        },
        'x'
      )
    ).rejects.toMatchObject({ code: 'provider_auth_failed', retryable: false });
    await expect(
      sendZaloText(
        {
          botToken: 'x',
          recipientId: 'ops-a',
          timeoutMs: 5000,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                ok: false,
                error_code: 'INVALID_RECIPIENT',
                description: 'phone=123'
              }),
              { status: 400 }
            )
        },
        'x'
      )
    ).rejects.toMatchObject({ code: 'invalid_recipient', retryable: false });
    await expect(
      sendZaloText(
        {
          botToken: 'x',
          recipientId: 'ops-a',
          timeoutMs: 5000,
          fetchImpl: async () => {
            throw new Error('secret');
          }
        },
        'x'
      )
    ).rejects.toBeInstanceOf(ZaloDeliveryError);
  });
});
