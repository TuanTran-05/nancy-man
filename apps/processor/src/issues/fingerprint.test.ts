import type { NormalizedEvent } from '../normalize/normalizeEvent.js';
import { describe, expect, it } from 'vitest';

import { fingerprintEvent } from './fingerprint.js';

function normalized(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
    occurredAt: new Date('2026-08-22T08:00:00.000Z'),
    receivedAt: new Date('2026-08-22T08:00:01.000Z'),
    source: 'browser',
    severity: 'medium',
    errorCode: 'STUDENT_LOAD_FAILED',
    exceptionType: 'TypeError',
    safeMessage: 'Could not load students',
    service: 'edutrack-web',
    release: '0123456789abcdef0123456789abcdef01234567',
    route: '/students',
    stackFrames: ['loadStudents (src/pages/Students.tsx:42:9)', 'render (src/App.tsx:12:3)'],
    tags: { studentId: 'student-01' },
    breadcrumbs: [],
    ...overrides
  };
}

describe('fingerprintEvent', () => {
  it('ignores volatile identity, request IDs, timestamps and entity values', () => {
    const first = fingerprintEvent(
      normalized({ userRef: 'USR_1', requestId: 'REQ_01K3ZABCDEF0123456789ABCDE' })
    );
    const repeat = fingerprintEvent(
      normalized({
        eventId: 'EVT_01K3ZABCDEF0123456789ABCDF',
        occurredAt: new Date('2026-08-22T09:00:00.000Z'),
        userRef: 'USR_2',
        requestId: 'REQ_01K3ZABCDEF0123456789ABCDF',
        tags: { studentId: 'student-02' }
      })
    );

    expect(repeat).toBe(first);
  });

  it('changes when a stable code or application frame changes', () => {
    expect(fingerprintEvent(normalized({ errorCode: 'STUDENT_SAVE_FAILED' }))).not.toBe(
      fingerprintEvent(normalized())
    );
    expect(
      fingerprintEvent(normalized({ stackFrames: ['saveStudents (src/pages/Students.tsx:75:9)'] }))
    ).not.toBe(fingerprintEvent(normalized()));
  });
});
