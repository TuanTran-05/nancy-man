import { describe, expect, it } from 'vitest';

import { NotificationWorker } from './worker.js';

const delivery = {
  id: 'delivery-1',
  channel: 'zalo' as const,
  recipientReference: 'oncall-ref',
  alert: {
    severity: 'critical' as const,
    issueId: 'ISS_01K3ZABCDEF0123456789ABCDE',
    title: 'Database unavailable',
    service: 'edutrack-api',
    release: '0123456789abcdef0123456789abcdef01234567',
    occurrenceCount: 4,
    firstSeenAt: new Date('2026-08-22T08:00:00.000Z'),
    lastSeenAt: new Date('2026-08-22T08:01:00.000Z'),
    issueUrl: 'https://man.thienuy.edu.vn/issues/ISS_01K3ZABCDEF0123456789ABCDE'
  }
};

describe('NotificationWorker', () => {
  it('marks a safe channel delivery complete after a provider acknowledgement', async () => {
    const completed: unknown[] = [];
    const worker = new NotificationWorker({
      channels: {
        zalo: { send: async () => ({ providerMessageId: 'zalo-1' }) },
        email: { send: async () => ({}) }
      },
      repository: {
        markDelivered: async (input) => {
          completed.push(input);
        },
        markFailed: async () => undefined,
        reportProviderFailure: async () => undefined
      }
    });

    await expect(worker.deliver(delivery)).resolves.toEqual({ delivered: true });
    expect(completed).toEqual([{ deliveryId: 'delivery-1', providerMessageId: 'zalo-1' }]);
  });

  it('records a failed provider delivery through a non-recursive internal path', async () => {
    const failures: unknown[] = [];
    const providerIssues: unknown[] = [];
    const worker = new NotificationWorker({
      channels: {
        zalo: {
          send: async () => {
            throw new Error('provider timeout token=never-log');
          }
        },
        email: { send: async () => ({}) }
      },
      repository: {
        markDelivered: async () => undefined,
        markFailed: async (input) => {
          failures.push(input);
        },
        reportProviderFailure: async (input) => {
          providerIssues.push(input);
        }
      }
    });

    await expect(worker.deliver(delivery)).resolves.toEqual({ delivered: false });
    expect(failures).toEqual([
      { deliveryId: 'delivery-1', failureCode: 'CHANNEL_DELIVERY_FAILED' }
    ]);
    expect(providerIssues).toEqual([{ channel: 'zalo', internal: true }]);
  });
});
