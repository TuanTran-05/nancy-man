import { formatSafeAlert, type SafeAlert } from './safeAlert.js';

export function createZaloChannel(input: {
  endpoint: string;
  resolveAccessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMilliseconds?: number;
}): {
  send: (input: {
    recipientReference: string;
    alert: SafeAlert;
  }) => Promise<{ providerMessageId?: string }>;
} {
  const fetcher = input.fetch ?? globalThis.fetch;
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 10_000;

  return {
    send: async ({ recipientReference, alert }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
      try {
        const token = await input.resolveAccessToken();
        const response = await fetcher(input.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            recipient_id: recipientReference,
            message: formatSafeAlert(alert).text
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Zalo notification failed with HTTP ${response.status}`);
        }
        const responseBody: unknown = await response.json().catch(() => ({}));
        const providerMessageId =
          typeof responseBody === 'object' && responseBody !== null && 'message_id' in responseBody
            ? String(responseBody.message_id).slice(0, 256)
            : undefined;
        return providerMessageId ? { providerMessageId } : {};
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
