import { captureOpsException } from './telemetry/runtimeTelemetry.js';

import type { TelemetryEnvelopeV1 } from '../../../packages/contracts/src/telemetry.js';

import type { IssueProcessorRepository } from './issues/processEnvelope.js';
import { processEnvelope } from './issues/processEnvelope.js';

type ClaimedEnvelope = {
  envelopeId: string;
  receivedAt: Date;
  ingestClientId: string;
  attemptCount?: number;
  envelope: TelemetryEnvelopeV1;
  identity?: { userRef: string; role: string; displayLabel: string; sessionHash: string };
};

const defaultProcessorMaxAttempts = 10;

export async function runProcessorOnce(input: {
  workerId: string;
  queue: {
    claimNext: (workerId: string, now: Date) => Promise<ClaimedEnvelope | null>;
    markRetry: (envelopeId: string, now: Date) => Promise<void>;
    deadLetter?: (input: {
      envelopeId: string;
      envelope: TelemetryEnvelopeV1;
      attemptCount: number;
      now: Date;
      failureCode: 'PROCESSING_FAILED';
    }) => Promise<void>;
  };
  repository: IssueProcessorRepository;
  sourceMaps?: {
    symbolicate: (input: {
      serviceName: string;
      release: string;
      stack?: string;
    }) => Promise<{ stackFrames: string[] }>;
  };
  telemetry?: {
    captureException: (
      error: unknown,
      context: { code: string; source: 'job'; tags: Record<string, string> }
    ) => unknown;
  };
  maxAttempts?: number;
  now?: () => Date;
}): Promise<{ processed: boolean; retried?: boolean; deadLettered?: boolean }> {
  const now = input.now ?? (() => new Date());
  const maxAttempts = input.maxAttempts ?? defaultProcessorMaxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('Processor max attempts must be between 1 and 100');
  }
  const claimed = await input.queue.claimNext(input.workerId, now());
  if (!claimed) return { processed: false };

  try {
    await processEnvelope(
      {
        envelopeId: claimed.envelopeId,
        receivedAt: claimed.receivedAt,
        ingestClientId: claimed.ingestClientId,
        envelope: claimed.envelope,
        ...(claimed.identity ? { identity: claimed.identity } : {})
      },
      input.repository,
      input.sourceMaps
    );
    return { processed: true };
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'process',
      status: 500,
    });
    input.telemetry?.captureException(error, {
      code: 'PROCESSOR_ENVELOPE_FAILED',
      source: 'job',
      tags: { envelopeId: claimed.envelopeId }
    });
    const attemptCount = (claimed.attemptCount ?? 0) + 1;
    if (input.queue.deadLetter && attemptCount >= maxAttempts) {
      await input.queue.deadLetter({
        envelopeId: claimed.envelopeId,
        envelope: claimed.envelope,
        attemptCount,
        now: now(),
        failureCode: 'PROCESSING_FAILED'
      });
      return { processed: false, deadLettered: true };
    }
    await input.queue.markRetry(claimed.envelopeId, now());
    return { processed: false, retried: true };
  }
}
