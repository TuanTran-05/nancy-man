import type { SafeAlert } from './channels/safeAlert.js';

type Channel = {
  send: (input: {
    recipientReference: string;
    alert: SafeAlert;
  }) => Promise<{ providerMessageId?: string }>;
};

export class NotificationWorker {
  constructor(
    private readonly input: {
      channels: Record<'zalo' | 'email', Channel>;
      repository: {
        markDelivered: (input: { deliveryId: string; providerMessageId?: string }) => Promise<void>;
        markFailed: (input: {
          deliveryId: string;
          failureCode: 'CHANNEL_DELIVERY_FAILED';
        }) => Promise<void>;
        reportProviderFailure: (input: {
          channel: 'zalo' | 'email';
          internal: true;
        }) => Promise<void>;
      };
    }
  ) {}

  async deliver(input: {
    id: string;
    channel: 'zalo' | 'email';
    recipientReference: string;
    alert: SafeAlert;
  }): Promise<{ delivered: boolean }> {
    try {
      const result = await this.input.channels[input.channel].send({
        recipientReference: input.recipientReference,
        alert: input.alert
      });
      await this.input.repository.markDelivered({
        deliveryId: input.id,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {})
      });
      return { delivered: true };
    } catch {
      await this.input.repository.markFailed({
        deliveryId: input.id,
        failureCode: 'CHANNEL_DELIVERY_FAILED'
      });
      await this.input.repository.reportProviderFailure({ channel: input.channel, internal: true });
      return { delivered: false };
    }
  }
}
