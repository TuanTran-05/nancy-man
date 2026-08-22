import type { TelemetryEnvelopeV1 } from '../../../packages/contracts/src/telemetry.js';

import type { IssueProcessorRepository } from './issues/processEnvelope.js';
import { processEnvelope } from './issues/processEnvelope.js';

type ClaimedEnvelope = {
  envelopeId: string;
  receivedAt: Date;
  ingestClientId: string;
  envelope: TelemetryEnvelopeV1;
  identity?: { userRef: string; role: string; displayLabel: string; sessionHash: string };
};

export async function runProcessorOnce(input: {
  workerId: string;
  queue: {
    claimNext: (workerId: string, now: Date) => Promise<ClaimedEnvelope | null>;
    markRetry: (envelopeId: string, now: Date) => Promise<void>;
  };
  repository: IssueProcessorRepository;
  sourceMaps?: { symbolicate: (input: { release: string; stack?: string }) => Promise<{ stackFrames: string[] }> };
  now?: () => Date;
}): Promise<{ processed: boolean; retried?: boolean }> {
  const now = input.now ?? (() => new Date());
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
  } catch {
    await input.queue.markRetry(claimed.envelopeId, now());
    return { processed: false, retried: true };
  }
}
