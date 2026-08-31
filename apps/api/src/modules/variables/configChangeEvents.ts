import {
  ChangeStatusResponseSchema,
  type ChangeStatusResponse
} from '../../../../../packages/config-contracts/src/changeProtocol.js';

function assertValueFree(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertValueFree);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      /^(?:value|oldValue|newValue|plaintext|bytes|command|args|environment|stdout|stderr)$/iu.test(
        key
      )
    ) {
      throw new Error('CONFIG_STATUS_NOT_VALUE_FREE');
    }
    assertValueFree(nested);
  }
}

export function serializeConfigChangeSse(status: ChangeStatusResponse): string {
  const parsed = ChangeStatusResponseSchema.parse(status);
  assertValueFree(parsed);
  const lastEvent = parsed.events.at(-1);
  return `${lastEvent ? `id: ${lastEvent.eventId}\n` : ''}event: change\ndata: ${JSON.stringify(parsed)}\n\n: heartbeat\n\n`;
}
