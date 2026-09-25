import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseTargetId } from '../../../../packages/contracts/src/databaseExplorer.js';
import { makeExplorerError } from './filterSql.js';

export const MAX_CURSOR_BYTES = 4096;
export const CURSOR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export type KeysetCursorData = {
  version: 1;
  kind: 'keyset';
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  checksum: string;
  issuedAt: number;
  expiresAt: number;
  sort?: { column: string; direction: 'asc' | 'desc' } | null;
  keys: Array<{ column: string; value: unknown }>;
};

export type OffsetCursorData = {
  version: 1;
  kind: 'offset';
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  checksum: string;
  issuedAt: number;
  expiresAt: number;
  offset: number;
};

export type CursorData = KeysetCursorData | OffsetCursorData;

export type RowRefData = {
  version: 1;
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  checksum: string;
  keys: Record<string, unknown>;
};

function signPayload(payloadJson: string, key: string): string {
  return createHmac('sha256', key).update(payloadJson).digest('base64url');
}

function verifySignature(payloadJson: string, signature: string, key: string): boolean {
  const expected = signPayload(payloadJson, key);
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  if (expectedBuf.length !== sigBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, sigBuf);
}

export function encodeCursor(cursor: CursorData, key: string): string {
  const payloadJson = JSON.stringify(cursor);
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = signPayload(encodedPayload, key);
  const result = `${encodedPayload}.${signature}`;

  if (Buffer.byteLength(result, 'utf8') > MAX_CURSOR_BYTES) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Cursor payload exceeds 4 KiB limit');
  }

  return result;
}

export function decodeCursor(input: {
  encodedCursor: string;
  key: string;
  expected: {
    targetId: DatabaseTargetId;
    schema: string;
    relation: string;
    checksum: string;
  };
  now?: () => Date;
}): CursorData {
  if (
    !input.encodedCursor ||
    typeof input.encodedCursor !== 'string' ||
    Buffer.byteLength(input.encodedCursor, 'utf8') > MAX_CURSOR_BYTES
  ) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Invalid cursor format or length');
  }

  const parts = input.encodedCursor.split('.');
  if (parts.length !== 2) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Malformed cursor structure');
  }

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (!encodedPayload || !signature) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Malformed cursor structure');
  }
  if (!verifySignature(encodedPayload, signature, input.key)) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Cursor signature verification failed');
  }

  let cursor: CursorData;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    cursor = JSON.parse(json);
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'job',
      status: 500
    });
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Cursor JSON decoding failed');
  }

  if (cursor.version !== 1 || (cursor.kind !== 'keyset' && cursor.kind !== 'offset')) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Unsupported cursor version or kind');
  }

  const currentTime = (input.now ? input.now() : new Date()).getTime();
  if (currentTime > cursor.expiresAt) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Cursor has expired');
  }

  if (
    cursor.targetId !== input.expected.targetId ||
    cursor.schema !== input.expected.schema ||
    cursor.relation !== input.expected.relation ||
    cursor.checksum !== input.expected.checksum
  ) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Cursor context mismatch or schema drift');
  }

  if (cursor.kind === 'offset' && cursor.offset > 10_000) {
    throw makeExplorerError(
      'DATABASE_PAGE_TOO_LARGE',
      'Offset pagination exceeds 10,000 row limit'
    );
  }

  return cursor;
}

export function encodeRowRef(rowRef: RowRefData, key: string): string {
  const payloadJson = JSON.stringify(rowRef);
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = signPayload(encodedPayload, key);
  const result = `${encodedPayload}.${signature}`;

  if (Buffer.byteLength(result, 'utf8') > MAX_CURSOR_BYTES) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Row reference payload exceeds 4 KiB limit');
  }

  return result;
}

export function decodeRowRef(input: {
  encodedRowRef: string;
  key: string;
  expected: {
    targetId: DatabaseTargetId;
    schema: string;
    relation: string;
    checksum: string;
  };
}): RowRefData {
  if (
    !input.encodedRowRef ||
    typeof input.encodedRowRef !== 'string' ||
    Buffer.byteLength(input.encodedRowRef, 'utf8') > MAX_CURSOR_BYTES
  ) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Invalid row reference format or length');
  }

  const parts = input.encodedRowRef.split('.');
  if (parts.length !== 2) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Malformed row reference structure');
  }

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (!encodedPayload || !signature) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Malformed row reference structure');
  }
  if (!verifySignature(encodedPayload, signature, input.key)) {
    throw makeExplorerError(
      'DATABASE_CURSOR_INVALID',
      'Row reference signature verification failed'
    );
  }

  let rowRef: RowRefData;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    rowRef = JSON.parse(json);
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'job',
      status: 500
    });
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Row reference JSON decoding failed');
  }

  if (rowRef.version !== 1) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Unsupported row reference version');
  }

  if (
    rowRef.targetId !== input.expected.targetId ||
    rowRef.schema !== input.expected.schema ||
    rowRef.relation !== input.expected.relation ||
    rowRef.checksum !== input.expected.checksum
  ) {
    throw makeExplorerError('DATABASE_CURSOR_INVALID', 'Row reference context mismatch');
  }

  return rowRef;
}
