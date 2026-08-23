import { describe, expect, it } from 'vitest';
import { runFailsafe } from './failsafe.js';

describe('collector failsafe', () => {
  it('sends only the fixed stopped message to configured recipients', async () => {
    const messages: string[] = [];
    await runFailsafe({ zaloBotToken: 'secret', recipientIds: ['ops-a', 'ops-b'], zaloTimeoutMs: 5000 }, async (_url, init) => {
      messages.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: '1' } }), { status: 200 });
    });
    expect(messages).toEqual(['CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn', 'CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn']);
  });
});
