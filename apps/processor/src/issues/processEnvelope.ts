import type { TelemetryEnvelopeV1 } from '../../../../packages/contracts/src/telemetry.js';

import { fingerprintEvent } from './fingerprint.js';
import { normalizeEvent, type NormalizedEvent } from '../normalize/normalizeEvent.js';

type IssueStatus = 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';

type IssueSnapshot = {
  id: string;
  status: IssueStatus;
  occurrenceCount: number;
  affectedUserCount: number;
};

export type IssueProcessorRepository = {
  withTransaction: <T>(operation: () => Promise<T>) => Promise<T>;
  findIssue: (fingerprint: string) => Promise<IssueSnapshot | null>;
  createIssue: (input: { fingerprint: string; event: NormalizedEvent }) => Promise<IssueSnapshot>;
  insertOccurrence: (input: {
    issueId: string;
    event: NormalizedEvent;
  }) => Promise<{ inserted: boolean; newAffectedUser: boolean }>;
  updateIssue: (input: {
    issueId: string;
    status: IssueStatus;
    occurrenceCount: number;
    affectedUserCount: number;
    lastSeenAt: Date;
  }) => Promise<void>;
  appendActivity: (input: {
    issueId: string;
    activityType: 'regressed';
    occurredAt: Date;
  }) => Promise<void>;
  markProcessed: (envelopeId: string) => Promise<void>;
};

type SignedIdentity = {
  userRef: string;
  role: string;
  displayLabel: string;
  sessionHash: string;
};

export async function processEnvelope(
  input: {
    envelopeId: string;
    receivedAt: Date;
    envelope: TelemetryEnvelopeV1;
    identity?: SignedIdentity;
  },
  repository: IssueProcessorRepository,
  sourceMaps?: {
    symbolicate: (input: { release: string; stack?: string }) => Promise<{ stackFrames: string[] }>;
  }
): Promise<{
  issueId: string;
  fingerprint: string;
  duplicate: boolean;
  stateChange?: 'created' | 'regressed';
  shouldNotify: boolean;
}> {
  let event = normalizeEvent({
    receivedAt: input.receivedAt,
    envelope: input.envelope,
    ...(input.identity ? { identity: input.identity } : {})
  });
  if (sourceMaps && event.stackTrace) {
    try {
      const symbolicated = await sourceMaps.symbolicate({
        release: event.release,
        stack: event.stackTrace
      });
      event = { ...event, stackFrames: symbolicated.stackFrames };
    } catch {
      // Persist the sanitized generated stack; source-map failures must not drop an error occurrence.
    }
  }
  const fingerprint = fingerprintEvent(event);

  return repository.withTransaction(async () => {
    let issue = await repository.findIssue(fingerprint);
    let stateChange: 'created' | 'regressed' | undefined;
    if (!issue) {
      issue = await repository.createIssue({ fingerprint, event });
      stateChange = 'created';
    }

    const occurrence = await repository.insertOccurrence({ issueId: issue.id, event });
    if (!occurrence.inserted) {
      await repository.markProcessed(input.envelopeId);
      return {
        issueId: issue.id,
        fingerprint,
        duplicate: true,
        shouldNotify: false
      };
    }

    const nextStatus: IssueStatus = issue.status === 'resolved' ? 'regressed' : issue.status;
    if (nextStatus === 'regressed' && issue.status !== 'regressed') {
      stateChange = 'regressed';
      await repository.appendActivity({
        issueId: issue.id,
        activityType: 'regressed',
        occurredAt: event.occurredAt
      });
    }
    await repository.updateIssue({
      issueId: issue.id,
      status: nextStatus,
      occurrenceCount: issue.occurrenceCount + 1,
      affectedUserCount: issue.affectedUserCount + (occurrence.newAffectedUser ? 1 : 0),
      lastSeenAt: event.occurredAt
    });
    await repository.markProcessed(input.envelopeId);

    return {
      issueId: issue.id,
      fingerprint,
      duplicate: false,
      ...(stateChange ? { stateChange } : {}),
      shouldNotify: nextStatus !== 'ignored' && (stateChange === 'created' || stateChange === 'regressed')
    };
  });
}
