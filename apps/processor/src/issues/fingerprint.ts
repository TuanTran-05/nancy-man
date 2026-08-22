import { createHash } from 'node:crypto';

import type { NormalizedEvent } from '../normalize/normalizeEvent.js';

function normalizedFrame(frame: string): string {
  return frame.replace(/:\d+:\d+/g, ':<line>:<column>').replace(/\s+/g, ' ').trim();
}

export function fingerprintEvent(event: NormalizedEvent): string {
  const fingerprintInput = [
    'v1',
    event.errorCode,
    event.service,
    event.exceptionType,
    event.route ?? event.tags.jobName ?? 'no-route',
    ...event.stackFrames.slice(0, 5).map(normalizedFrame)
  ].join('\n');
  return `sha256:${createHash('sha256').update(fingerprintInput, 'utf8').digest('hex')}`;
}
