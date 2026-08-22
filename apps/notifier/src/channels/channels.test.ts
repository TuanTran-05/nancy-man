import { describe, expect, it } from 'vitest';

import { createEmailChannel } from './email.js';
import { createZaloChannel } from './zalo.js';

const alert = {
  severity: 'critical' as const,
  issueId: 'ISS_01K3ZABCDEF0123456789ABCDE',
  title: 'Database unavailable',
  service: 'edutrack-api',
  release: '0123456789abcdef0123456789abcdef01234567',
  occurrenceCount: 12,
  firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
  lastSeenAt: new Date('2026-08-22T08:02:00.000Z'),
  issueUrl: 'https://man.thienuy.edu.vn/issues/ISS_01K3ZABCDEF0123456789ABCDE'
};

describe('alert channels', () => {
  it('sends a Zalo payload with only the safe operational summary', async () => {
    const requests: RequestInit[] = [];
    const zalo = createZaloChannel({
      endpoint: 'https://zalo.example/messages',
      resolveAccessToken: async () => 'provider-token',
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({ message_id: 'zalo-message-1' }), { status: 200 });
      }
    });

    await expect(zalo.send({ recipientReference: 'recipient-ref', alert })).resolves.toEqual({
      providerMessageId: 'zalo-message-1'
    });
    const serialized = String(requests[0]?.body);
    expect(serialized).toContain(alert.issueId);
    expect(serialized).not.toContain('provider-token');
    expect(serialized).not.toMatch(/stack|password|authorization/i);
  });

  it('hands the same safe summary to the email transport without exposing provider secrets', async () => {
    const sent: unknown[] = [];
    const email = createEmailChannel({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'email-message-1' };
      }
    });

    await expect(email.send({ recipientReference: 'oncall@thienuy.edu.vn', alert })).resolves.toEqual({
      providerMessageId: 'email-message-1'
    });
    expect(sent).toMatchObject([
      {
        to: 'oncall@thienuy.edu.vn',
        subject: expect.stringContaining(alert.issueId),
        text: expect.stringContaining(alert.issueUrl)
      }
    ]);
  });
});
