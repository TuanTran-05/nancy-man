import { describe, expect, it } from 'vitest';

import { runProcessorOnce } from './index.js';

describe('runProcessorOnce', () => {
  it('returns an error envelope to retry when processing fails', async () => {
    const retried: string[] = [];
    const result = await runProcessorOnce({
      workerId: 'processor-1',
      queue: {
        claimNext: async () => ({
          envelopeId: 'env-1',
          receivedAt: new Date('2026-08-22T08:00:00.000Z'),
          ingestClientId: 'client-1',
          envelope: {
            schemaVersion: 1,
            eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
            idempotencyKey: 'idem-0123456789abcdef',
            capturedAt: '2026-08-22T08:00:00.000Z',
            source: 'api',
            level: 'error',
            error: { name: 'Error', code: 'SERVER_EXCEPTION', safeMessage: 'failed' },
            context: { release: 'release', service: 'edutrack-api', environment: 'production' }
          }
        }),
        markRetry: async (envelopeId) => {
          retried.push(envelopeId);
        }
      },
      repository: {
        withTransaction: async () => {
          throw new Error('database unavailable');
        },
        findIssue: async () => null,
        createIssue: async () => ({
          issue: {
            id: 'ISS_01K3ZABCDEF0123456789ABCDE',
            status: 'new' as const,
            occurrenceCount: 0,
            affectedUserCount: 0
          },
          created: true
        }),
        insertOccurrence: async () => ({ inserted: true, newAffectedUser: false }),
        updateIssue: async () => undefined,
        appendActivity: async () => undefined,
        markProcessed: async () => undefined
      }
    });

    expect(result).toEqual({ processed: false, retried: true });
    expect(retried).toEqual(['env-1']);
  });

  it('reports the original processor failure and dead-letters it at the retry limit', async () => {
    const captured: unknown[] = [];
    const deadLetters: unknown[] = [];
    const result = await runProcessorOnce({
      workerId: 'processor-1',
      queue: {
        claimNext: async () => ({
          envelopeId: 'env-2',
          receivedAt: new Date('2026-09-04T00:00:00.000Z'),
          ingestClientId: 'client-1',
          attemptCount: 9,
          envelope: {
            schemaVersion: 1,
            eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
            idempotencyKey: 'idem-0123456789abcdef',
            capturedAt: '2026-09-04T00:00:00.000Z',
            source: 'api',
            level: 'error',
            error: { name: 'Error', code: 'SERVER_EXCEPTION', safeMessage: 'failed' },
            context: { release: 'release', service: 'edutrack-api', environment: 'production' }
          }
        }),
        markRetry: async () => undefined,
        deadLetter: async (input) => {
          deadLetters.push(input);
        }
      },
      repository: {
        withTransaction: async () => {
          throw new Error('database unavailable');
        },
        findIssue: async () => null,
        createIssue: async () => ({
          issue: {
            id: 'ISS_01K3ZABCDEF0123456789ABCDE',
            status: 'new' as const,
            occurrenceCount: 0,
            affectedUserCount: 0
          },
          created: true
        }),
        insertOccurrence: async () => ({ inserted: true, newAffectedUser: false }),
        updateIssue: async () => undefined,
        appendActivity: async () => undefined,
        markProcessed: async () => undefined
      },
      telemetry: {
        captureException: (error) => captured.push(error)
      }
    });

    expect(result).toEqual({ processed: false, deadLettered: true });
    expect(captured).toEqual([expect.objectContaining({ message: 'database unavailable' })]);
    expect(deadLetters).toEqual([
      expect.objectContaining({
        envelopeId: 'env-2',
        attemptCount: 10,
        failureCode: 'PROCESSING_FAILED'
      })
    ]);
  });
});
