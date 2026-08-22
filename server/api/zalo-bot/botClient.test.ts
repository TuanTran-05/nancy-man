import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendZaloBotText, ZaloBotApiError } from './botClient';

vi.stubGlobal('fetch', vi.fn());

describe('botClient', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  const config = { token: 'TEST_TOKEN', requestTimeoutMs: 5000 };

  it('1. POSTs to correct URL with JSON body { chat_id, text }', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: '123' } }))
    );
    await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config);
    expect(fetch).toHaveBeenCalledWith(
      'https://bot-api.zaloplatforms.com/botTEST_TOKEN/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat_id: 'chat1', text: 'hello' }),
      })
    );
  });

  it('2. Adds Content-Type: application/json', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: '123' } }))
    );
    await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('3. Rejects empty text (throws before fetch)', async () => {
    await expect(sendZaloBotText({ chatId: 'chat1', text: '' }, config)).rejects.toThrowError(
      ZaloBotApiError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('4. Rejects text > 2000 chars (throws before fetch)', async () => {
    await expect(
      sendZaloBotText({ chatId: 'chat1', text: 'a'.repeat(2001) }, config)
    ).rejects.toThrowError(ZaloBotApiError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('5. HTTP 200 with ok:false throws (not treated as success)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 401 }))
    );
    await expect(sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config)).rejects.toThrowError(
      ZaloBotApiError
    );
  });

  it('6. Provider error_code 401 -> kind auth, abortBatch true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 401 }))
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('auth');
    expect(err.abortBatch).toBe(true);
  });

  it('7. Provider 403 -> kind transient (NOT auth)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 403 }))
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('transient');
  });

  it('8. Provider 408, 5xx -> kind transient', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 502 }))
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('transient');
  });

  it('9. Provider 429 -> kind rate_limited, parses Retry-After, clamps 5000-300000ms', async () => {
    const headers = new Headers({ 'Retry-After': '10' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 429 }), { headers })
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(10000);
  });

  it('10. Provider 400/404 with chat-related description -> kind invalid_chat', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 400, description: 'chat invalid' }))
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('invalid_chat');
  });

  it('11. Provider 400/404 without chat-related description -> kind permanent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 400, description: 'something else' }))
    );
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('permanent');
  });

  it('12. AbortSignal timeout -> kind transient, deliveryAmbiguous true', async () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    vi.mocked(fetch).mockRejectedValueOnce(error);
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('transient');
    expect(err.deliveryAmbiguous).toBe(true);
  });

  it('13. Network error -> kind transient, deliveryAmbiguous true', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('transient');
    expect(err.deliveryAmbiguous).toBe(true);
  });

  it('14. Missing/malformed JSON -> falls back to HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json', { status: 400 }));
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.kind).toBe('permanent');
    expect(err.statusCode).toBe(400);
  });

  it('15. Error messages dont contain token or URL', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = (await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config).catch(
      (e) => e
    )) as ZaloBotApiError;
    expect(err.message).not.toContain('TEST_TOKEN');
    expect(err.message).not.toContain('zaloplatforms.com');
  });

  it('16. On success, returns { messageId } from result.message_id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 'msg123' } }))
    );
    const res = await sendZaloBotText({ chatId: 'chat1', text: 'hello' }, config);
    expect(res).toEqual({ messageId: 'msg123' });
  });
});
