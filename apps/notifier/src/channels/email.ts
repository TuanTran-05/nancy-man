import { formatSafeAlert, type SafeAlert } from './safeAlert.js';

export function createEmailChannel(input: {
  sendMail: (message: { to: string; subject: string; text: string }) => Promise<{ messageId?: string }>;
}): {
  send: (input: { recipientReference: string; alert: SafeAlert }) => Promise<{ providerMessageId?: string }>;
} {
  return {
    send: async ({ recipientReference, alert }) => {
      const message = formatSafeAlert(alert);
      const result = await input.sendMail({
        to: recipientReference,
        subject: message.subject,
        text: message.text
      });
      return result.messageId ? { providerMessageId: result.messageId } : {};
    }
  };
}
