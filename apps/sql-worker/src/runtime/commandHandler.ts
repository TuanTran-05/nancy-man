import type { WorkerCommand } from '../../../../packages/contracts/src/workerProtocol.js';
import type { DatabaseSchemaSnapshot } from '../../../../packages/contracts/src/databaseSchema.js';

import { classifyReadOnlySql } from '../execution/readClassification.js';
import { classifyMutationSql } from '../execution/mutationClassification.js';
type ReadWorker =
  | { enabled: false }
  | {
      enabled: true;
      preview: (input: { sql: string; maxRows?: number }) => Promise<unknown>;
      schema: () => Promise<DatabaseSchemaSnapshot>;
    };

type MutationWorker =
  | { enabled: false }
  | {
      enabled: true;
      preview: (input: {
        executionId: string;
        executionKey: string;
        actorUserId: string;
        actorSessionId: string;
        reason: string;
        sql: string;
        maxChanges?: number;
      }) => Promise<unknown>;
    };

export class SqlWorkerCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function readPayload(payload: unknown): { sql: string; maxRows?: number } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SqlWorkerCommandError('WORKER_COMMAND_INVALID');
  }
  const value = payload as { sql?: unknown; maxRows?: unknown };
  if (typeof value.sql !== 'string' || value.sql.trim().length === 0 || value.sql.length > 65_536) {
    throw new SqlWorkerCommandError('WORKER_COMMAND_INVALID');
  }
  if (
    value.maxRows !== undefined &&
    (typeof value.maxRows !== 'number' ||
      !Number.isInteger(value.maxRows) ||
      value.maxRows < 1 ||
      value.maxRows > 500)
  ) {
    throw new SqlWorkerCommandError('WORKER_COMMAND_INVALID');
  }
  return value.maxRows === undefined
    ? { sql: value.sql }
    : { sql: value.sql, maxRows: value.maxRows };
}

function mutationPayload(payload: unknown): {
  executionId: string;
  executionKey: string;
  reason: string;
  sql: string;
  maxChanges?: number;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SqlWorkerCommandError('WORKER_COMMAND_INVALID');
  }
  const value = payload as {
    executionId?: unknown;
    executionKey?: unknown;
    reason?: unknown;
    sql?: unknown;
    maxChanges?: unknown;
  };
  if (
    typeof value.executionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.executionId
    ) ||
    typeof value.executionKey !== 'string' ||
    value.executionKey.length < 12 ||
    value.executionKey.length > 200 ||
    typeof value.reason !== 'string' ||
    value.reason.trim().length < 3 ||
    value.reason.trim().length > 2_000 ||
    typeof value.sql !== 'string' ||
    value.sql.trim().length === 0 ||
    value.sql.length > 65_536 ||
    (value.maxChanges !== undefined &&
      (typeof value.maxChanges !== 'number' ||
        !Number.isInteger(value.maxChanges) ||
        value.maxChanges < 1 ||
        value.maxChanges > 500))
  ) {
    throw new SqlWorkerCommandError('WORKER_COMMAND_INVALID');
  }
  return value.maxChanges === undefined
    ? {
        executionId: value.executionId,
        executionKey: value.executionKey,
        reason: value.reason.trim(),
        sql: value.sql
      }
    : {
        executionId: value.executionId,
        executionKey: value.executionKey,
        reason: value.reason.trim(),
        sql: value.sql,
        maxChanges: value.maxChanges
      };
}

export function createSqlWorkerCommandHandler(input: {
  read: ReadWorker;
  mutation?: MutationWorker;
}): {
  handle: (command: WorkerCommand) => Promise<unknown>;
}['handle'] {
  return async (command) => {
    if (command.kind === 'schema.read') {
      if (!input.read.enabled) throw new SqlWorkerCommandError('SQL_READ_DISABLED');
      return input.read.schema();
    }
    if (command.kind === 'sql.classify') {
      return classifyReadOnlySql(readPayload(command.payload).sql);
    }
    if (command.kind === 'sql.classifyMutation') {
      return classifyMutationSql(readPayload(command.payload).sql);
    }
    if (command.kind === 'sql.previewRead') {
      if (!input.read.enabled) throw new SqlWorkerCommandError('SQL_READ_DISABLED');
      const payload = readPayload(command.payload);
      return input.read.preview(payload);
    }
    if (command.kind === 'sql.previewMutation') {
      if (!input.mutation || !input.mutation.enabled) {
        throw new SqlWorkerCommandError('SQL_MUTATION_DISABLED');
      }
      const payload = mutationPayload(command.payload);
      return input.mutation.preview({
        ...payload,
        actorUserId: command.actor.userId,
        actorSessionId: command.actor.sessionId
      });
    }
    throw new SqlWorkerCommandError('WORKER_COMMAND_UNSUPPORTED');
  };
}
