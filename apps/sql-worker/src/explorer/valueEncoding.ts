import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import { createHash } from 'node:crypto';
import type {
  DatabaseCell,
  DatabaseExplorerColumn
} from '../../../../packages/contracts/src/databaseExplorer.js';
import { maskPiiValue } from '../../../../packages/security/src/database/columnPolicy.js';

export const MAX_CELL_BYTES = 64 * 1024; // 64 KiB
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB

export type EncodeCellInput = {
  columnName: string;
  column: DatabaseExplorerColumn;
  rawValue: unknown;
  piiMode: 'masked' | 'revealed';
};

export function encodeCell(input: {
  columnName: string;
  column: DatabaseExplorerColumn;
  rawValue: unknown;
  piiMode: 'masked' | 'revealed';
}): DatabaseCell {
  if (input.column.classification === 'blocked') {
    return { state: 'blocked' };
  }

  if (input.rawValue === null || input.rawValue === undefined) {
    return { state: 'value', value: null };
  }

  if (input.column.classification === 'pii' && input.piiMode === 'masked') {
    const colLower = input.columnName.toLowerCase();
    const hint = colLower.includes('email')
      ? 'email'
      : colLower.includes('phone')
        ? 'phone'
        : undefined;

    return {
      state: 'masked',
      display: maskPiiValue(input.rawValue, hint)
    };
  }

  // Bytea handling
  if (input.column.dataType.toLowerCase() === 'bytea' || Buffer.isBuffer(input.rawValue)) {
    let buf: Buffer;
    if (Buffer.isBuffer(input.rawValue)) {
      buf = input.rawValue;
    } else if (typeof input.rawValue === 'string' && input.rawValue.startsWith('\\x')) {
      buf = Buffer.from(input.rawValue.slice(2), 'hex');
    } else {
      buf = Buffer.from(String(input.rawValue), 'utf8');
    }

    const digest = createHash('sha256').update(buf).digest('hex');
    return {
      state: 'value',
      value: `<bytea: ${buf.length} bytes, sha256: ${digest}>`
    };
  }

  // Date objects
  if (input.rawValue instanceof Date) {
    return {
      state: 'value',
      value: input.rawValue.toISOString()
    };
  }

  // String check for 64 KiB
  if (typeof input.rawValue === 'string') {
    const byteLength = Buffer.byteLength(input.rawValue, 'utf8');
    if (byteLength > MAX_CELL_BYTES) {
      return {
        state: 'truncated',
        display: input.rawValue.slice(0, 500) + '...',
        originalBytes: byteLength
      };
    }
    return { state: 'value', value: input.rawValue };
  }

  // Object/array check for 64 KiB
  if (typeof input.rawValue === 'object') {
    try {
      const json = JSON.stringify(input.rawValue);
      const byteLength = Buffer.byteLength(json, 'utf8');
      if (byteLength > MAX_CELL_BYTES) {
        return {
          state: 'truncated',
          display: json.slice(0, 500) + '...',
          originalBytes: byteLength
        };
      }
      return { state: 'value', value: input.rawValue as Record<string, unknown> | unknown[] };
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'job',
        status: 500
      });
      return { state: 'value', value: String(input.rawValue) };
    }
  }

  return {
    state: 'value',
    value: input.rawValue as null | boolean | number | string
  };
}

export type EncodedRow = {
  rowRef: string | null;
  cells: Record<string, DatabaseCell>;
};

export type EncodeRowPageResult = {
  rows: EncodedRow[];
  truncated: boolean;
  encodedBytes: number;
};

export function encodeRowPage(
  rows: EncodedRow[],
  maxBytes: number = MAX_RESPONSE_BYTES
): EncodeRowPageResult {
  const acceptedRows: EncodedRow[] = [];
  let totalBytes = 2; // For outer `[]`
  let truncated = false;

  for (const row of rows) {
    const rowJson = JSON.stringify(row);
    const rowBytes = Buffer.byteLength(rowJson, 'utf8') + (acceptedRows.length > 0 ? 1 : 0);

    if (totalBytes + rowBytes > maxBytes) {
      truncated = true;
      break;
    }

    acceptedRows.push(row);
    totalBytes += rowBytes;
  }

  return {
    rows: acceptedRows,
    truncated,
    encodedBytes: totalBytes
  };
}
