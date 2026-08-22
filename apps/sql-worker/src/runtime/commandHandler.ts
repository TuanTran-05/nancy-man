import type { WorkerCommand } from '../../../../packages/contracts/src/workerProtocol.js';
import type { DatabaseSchemaSnapshot } from '../../../../packages/contracts/src/databaseSchema.js';

import { classifyReadOnlySql } from '../execution/readClassification.js';
type ReadWorker =
  | { enabled: false }
  | {
      enabled: true;
      preview: (input: { sql: string; maxRows?: number }) => Promise<unknown>;
      schema: () => Promise<DatabaseSchemaSnapshot>;
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

export function createSqlWorkerCommandHandler(input: { read: ReadWorker }): {
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
    if (command.kind === 'sql.previewRead') {
      if (!input.read.enabled) throw new SqlWorkerCommandError('SQL_READ_DISABLED');
      const payload = readPayload(command.payload);
      return input.read.preview(payload);
    }
    throw new SqlWorkerCommandError('WORKER_COMMAND_UNSUPPORTED');
  };
}
