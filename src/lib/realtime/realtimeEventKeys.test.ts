import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REALTIME_EVENT_KEYS } from './realtimeEventKeys';

const here = dirname(fileURLToPath(import.meta.url));
const serverEventsPath = resolve(here, '../../../server/api/lib/realtime/events.ts');

/**
 * The server file cannot be imported here: it pulls in legacyAuth-admin. Reading
 * the union out of the source text is enough to catch the drift that matters —
 * a server key with no client counterpart is an event nobody listens to.
 */
function serverEventKeys(): string[] {
  const source = readFileSync(serverEventsPath, 'utf8');
  const union = source.slice(
    source.indexOf('export type RealtimeEventKey'),
    source.indexOf(';', source.indexOf('export type RealtimeEventKey'))
  );
  return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

describe('client realtime event registry', () => {
  it('covers every key the server can emit', () => {
    const missing = serverEventKeys().filter((key) => !REALTIME_EVENT_KEYS.includes(key as never));
    expect(missing).toEqual([]);
  });

  it('reads at least the keys we know the server declares', () => {
    // Guards the parser above: if the slice stops matching, this fails loudly
    // instead of silently comparing against an empty list.
    expect(serverEventKeys()).toContain('students');
    expect(serverEventKeys()).toContain('print-requests');
  });

  it('has no duplicate entries', () => {
    expect(new Set(REALTIME_EVENT_KEYS).size).toBe(REALTIME_EVENT_KEYS.length);
  });
});
