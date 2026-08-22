import type { TelemetryEnvelopeV1 } from '../../../../packages/contracts/src/telemetry.js';
import { describe, expect, it } from 'vitest';

import { normalizeEvent } from './normalizeEvent.js';

const envelope: TelemetryEnvelopeV1 = {
  schemaVersion: 1,
  eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
  idempotencyKey: 'idem-0123456789abcdef',
  capturedAt: '2026-08-22T08:00:00.000Z',
  source: 'browser',
  level: 'error',
  error: {
    name: 'TypeError',
    code: 'STUDENT_LOAD_FAILED',
    safeMessage: 'Could not load students',
    stack:
      'TypeError: Could not load students\n    at loadStudents (https://thienuy.edu.vn/assets/app.js:10:2)\n    at chrome-extension://abc/content.js:1:2'
  },
  context: {
    requestId: 'REQ_01K3ZABCDEF0123456789ABCDE',
    release: '0123456789abcdef0123456789abcdef01234567',
    service: 'edutrack-web',
    environment: 'production',
    route: '/students',
    tags: { studentId: 'student-01' },
    breadcrumbs: [{ at: '2026-08-22T08:00:00.000Z', category: 'click', message: 'load' }]
  }
};

describe('normalizeEvent', () => {
  it('turns a sanitized raw envelope into an occurrence while retaining only safe context', () => {
    const normalized = normalizeEvent({
      receivedAt: new Date('2026-08-22T08:00:01.000Z'),
      envelope,
      identity: { userRef: 'USR_123', role: 'teacher', displayLabel: 'Teacher', sessionHash: 'a'.repeat(64) }
    });

    expect(normalized).toMatchObject({
      eventId: envelope.eventId,
      occurredAt: new Date('2026-08-22T08:00:00.000Z'),
      severity: 'medium',
      userRef: 'USR_123',
      route: '/students',
      stackFrames: ['loadStudents (https://thienuy.edu.vn/assets/app.js:10:2)']
    });
    expect(normalized.stackFrames.join('\n')).not.toContain('chrome-extension');
  });

  it('treats fatal/database-unavailable failures as critical and falls back to receive time', () => {
    const normalized = normalizeEvent({
      receivedAt: new Date('2026-08-22T08:00:01.000Z'),
      envelope: {
        ...envelope,
        capturedAt: 'not-a-date',
        source: 'database',
        level: 'fatal',
        error: { ...envelope.error, code: 'DB_UNAVAILABLE' }
      }
    });

    expect(normalized.occurredAt).toEqual(new Date('2026-08-22T08:00:01.000Z'));
    expect(normalized.severity).toBe('critical');
  });
});
