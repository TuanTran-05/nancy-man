import { describe, expect, it } from 'vitest';

import { sanitizeTelemetry } from './sanitizer.js';

describe('telemetry sanitizer', () => {
  it('redacts secrets and personal data recursively before an envelope can be spooled or sent', () => {
    const input = {
      schemaVersion: 1,
      eventId: 'EVT_01K3EXAMPLE',
      idempotencyKey: 'key',
      capturedAt: '2026-08-22T03:14:00.000Z',
      source: 'browser',
      level: 'error',
      error: {
        name: 'Error',
        code: 'BROWSER_EXCEPTION',
        safeMessage: 'Authorization: Bearer abc.def.ghi',
        stack: 'connect postgres://user:password@db.internal/app; otp=123456'
      },
      context: {
        release: '0123456789abcdef0123456789abcdef01234567',
        service: 'edutrack-web',
        environment: 'production',
        route: '/students?phone=0912345678',
        tags: {
          studentId: 'student-01',
          invoiceId: 'invoice-01',
          authorization: 'Bearer should-not-survive',
          email: 'owner@example.test',
          faceImage: 'data:image/png;base64,secret'
        },
        breadcrumbs: [
          {
            at: '2026-08-22T03:14:00.000Z',
            category: 'click',
            message: 'password=do-not-store'
          }
        ]
      },
      requestBody: { assignmentText: 'private student work' }
    };

    const sanitized = sanitizeTelemetry(input, { sessionPepper: 'telemetry-pepper' });
    const serialized = JSON.stringify(sanitized.envelope);

    expect(serialized).not.toMatch(
      /Bearer |postgres:\/\/|authorization|password|otp|data:image|0912345678/i
    );
    expect(serialized).toContain('[REDACTED]');
    expect(sanitized.envelope.context.tags).toEqual({
      studentId: 'student-01',
      invoiceId: 'invoice-01'
    });
    expect(sanitized.redacted).toBe(true);
  });

  it('handles circular values and drops unrecognized context instead of serializing it', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const sanitized = sanitizeTelemetry(
      {
        schemaVersion: 1,
        eventId: 'EVT_01K3EXAMPLE',
        idempotencyKey: 'key',
        capturedAt: '2026-08-22T03:14:00.000Z',
        source: 'job',
        level: 'error',
        error: { name: 'Error', code: 'JOB_FAILED', safeMessage: 'failed' },
        context: {
          release: '0123456789abcdef0123456789abcdef01234567',
          service: 'edutrack-worker',
          environment: 'production',
          unknown: circular
        }
      },
      { sessionPepper: 'telemetry-pepper' }
    );

    expect(JSON.stringify(sanitized.envelope)).not.toContain('self');
  });
});
