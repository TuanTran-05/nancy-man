import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import {
  isDatabaseTargetId,
  type DatabaseTargetId
} from '../../../../packages/contracts/src/databaseExplorer.js';
import { makeExplorerError } from './filterSql.js';

export const MAX_CURSOR_BYTES = 4096;
export const CURSOR_EXPIRY_MS = 5 * 60 * 1000;

const ENVELOPE_VERSION = 'v2';
const TOKEN_KINDS = ['cursor', 'row-ref'] as const;
type TokenKind = (typeof TOKEN_KINDS)[number];
type Context = {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  checksum: string;
};
type SortDefinition = { column: string; direction: 'asc' | 'desc' };

export type KeysetCursorData = Context & {
  version: 1;
  kind: 'keyset';
  issuedAt: number;
  expiresAt: number;
  sort: SortDefinition | null;
  nullOrder: 'last';
  keys: Array<{ column: string; value: unknown }>;
};

export type OffsetCursorData = Context & {
  version: 1;
  kind: 'offset';
  issuedAt: number;
  expiresAt: number;
  offset: number;
  sort: SortDefinition | null;
  nullOrder: 'last';
};

export type CursorData = KeysetCursorData | OffsetCursorData;

export type RowRefData = Context & {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  keys: Record<string, unknown>;
};

function cursorError(): Error {
  return makeExplorerError('DATABASE_CURSOR_INVALID');
}

export function isValidCursorKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}

function decodeMasterKey(value: string): Buffer {
  if (!isValidCursorKey(value)) throw cursorError();
  return Buffer.from(value, 'base64');
}

function deriveEncryptionKey(value: string, kind: TokenKind): Buffer {
  const masterKey = decodeMasterKey(value);
  const info = kind === 'cursor' ? 'cursor/v2' : 'row-ref/v2';
  return Buffer.from(hkdfSync('sha256', masterKey, 'database-explorer/v2', info, 32));
}

function contextAad(kind: TokenKind, context: Context): Buffer {
  return Buffer.from(
    JSON.stringify([
      ENVELOPE_VERSION,
      kind,
      context.targetId,
      context.schema,
      context.relation,
      context.checksum
    ]),
    'utf8'
  );
}

function validateContext(value: unknown): value is Context {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<Context>;
  return (
    isDatabaseTargetId(context.targetId) &&
    typeof context.schema === 'string' &&
    context.schema.length > 0 &&
    typeof context.relation === 'string' &&
    context.relation.length > 0 &&
    typeof context.checksum === 'string' &&
    context.checksum.length > 0
  );
}

function validateSort(value: unknown): value is SortDefinition | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const sort = value as Partial<SortDefinition>;
  return (
    typeof sort.column === 'string' &&
    sort.column.length > 0 &&
    (sort.direction === 'asc' || sort.direction === 'desc')
  );
}

function validateTimes(value: { issuedAt?: unknown; expiresAt?: unknown }): boolean {
  return (
    Number.isSafeInteger(value.issuedAt) &&
    Number.isSafeInteger(value.expiresAt) &&
    (value.expiresAt as number) > (value.issuedAt as number) &&
    (value.expiresAt as number) - (value.issuedAt as number) <= CURSOR_EXPIRY_MS
  );
}

function validateCursor(value: unknown): value is CursorData {
  if (!validateContext(value) || !value || typeof value !== 'object') return false;
  const cursor = value as Partial<CursorData>;
  if (
    cursor.version !== 1 ||
    !validateTimes(cursor) ||
    !validateSort(cursor.sort) ||
    cursor.nullOrder !== 'last'
  ) {
    return false;
  }
  if (cursor.kind === 'offset') {
    return Number.isSafeInteger(cursor.offset) && (cursor.offset as number) >= 0;
  }
  if (cursor.kind !== 'keyset' || !Array.isArray(cursor.keys) || cursor.keys.length === 0) {
    return false;
  }
  const columns = new Set<string>();
  return cursor.keys.every((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.column !== 'string' ||
      entry.column.length === 0 ||
      !Object.prototype.hasOwnProperty.call(entry, 'value') ||
      columns.has(entry.column)
    ) {
      return false;
    }
    columns.add(entry.column);
    return true;
  });
}

function validateRowRef(value: unknown): value is RowRefData {
  if (!validateContext(value) || !value || typeof value !== 'object') return false;
  const rowRef = value as Partial<RowRefData>;
  if (
    rowRef.version !== 1 ||
    !validateTimes(rowRef) ||
    !rowRef.keys ||
    typeof rowRef.keys !== 'object' ||
    Array.isArray(rowRef.keys)
  ) {
    return false;
  }
  const keys = Object.entries(rowRef.keys);
  return keys.length > 0 && keys.every(([column]) => column.length > 0);
}

function seal(kind: TokenKind, value: CursorData | RowRefData, key: string): string {
  if (!validateContext(value)) throw cursorError();
  const nonce = randomBytes(12);
  let plaintext: string;
  try {
    plaintext = JSON.stringify(value);
  } catch {
    throw cursorError();
  }
  if (!plaintext) throw cursorError();

  try {
    const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(key, kind), nonce);
    cipher.setAAD(contextAad(kind, value));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const token = [
      ENVELOPE_VERSION,
      kind,
      nonce.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url')
    ].join('.');
    if (Buffer.byteLength(token, 'utf8') > MAX_CURSOR_BYTES) throw cursorError();
    return token;
  } catch {
    throw cursorError();
  }
}

function open(input: { token: string; kind: TokenKind; key: string; expected: Context }): unknown {
  if (
    typeof input.token !== 'string' ||
    input.token.length === 0 ||
    Buffer.byteLength(input.token, 'utf8') > MAX_CURSOR_BYTES ||
    !validateContext(input.expected)
  ) {
    throw cursorError();
  }
  const parts = input.token.split('.');
  if (
    parts.length !== 5 ||
    parts[0] !== ENVELOPE_VERSION ||
    parts[1] !== input.kind ||
    !parts[2] ||
    !parts[3] ||
    !parts[4]
  ) {
    throw cursorError();
  }

  try {
    const nonce = Buffer.from(parts[2]!, 'base64url');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    const tag = Buffer.from(parts[4]!, 'base64url');
    if (
      nonce.length !== 12 ||
      ciphertext.length === 0 ||
      tag.length !== 16 ||
      nonce.toString('base64url') !== parts[2] ||
      ciphertext.toString('base64url') !== parts[3] ||
      tag.toString('base64url') !== parts[4]
    ) {
      throw cursorError();
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(input.key, input.kind),
      nonce
    );
    decipher.setAAD(contextAad(input.kind, input.expected));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw cursorError();
  }
}

function assertContextMatches(value: Context, expected: Context): void {
  if (
    value.targetId !== expected.targetId ||
    value.schema !== expected.schema ||
    value.relation !== expected.relation ||
    value.checksum !== expected.checksum
  ) {
    throw cursorError();
  }
}

function assertNotExpired(value: { issuedAt: number; expiresAt: number }, now: Date): void {
  if (!validateTimes(value) || now.getTime() >= value.expiresAt) throw cursorError();
}

export function encodeCursor(cursor: CursorData, key: string): string {
  if (!validateCursor(cursor)) throw cursorError();
  return seal('cursor', cursor, key);
}

export function decodeCursor(input: {
  encodedCursor: string;
  key: string;
  expected: Context;
  now?: () => Date;
}): CursorData {
  const cursor = open({
    token: input.encodedCursor,
    kind: 'cursor',
    key: input.key,
    expected: input.expected
  });
  if (!validateCursor(cursor)) throw cursorError();
  assertNotExpired(cursor, (input.now ?? (() => new Date()))());
  assertContextMatches(cursor, input.expected);
  if (cursor.kind === 'offset' && cursor.offset > 10_000) {
    throw makeExplorerError('DATABASE_PAGE_TOO_LARGE');
  }
  return cursor;
}

export function encodeRowRef(rowRef: RowRefData, key: string): string {
  if (!validateRowRef(rowRef)) throw cursorError();
  return seal('row-ref', rowRef, key);
}

export function decodeRowRef(input: {
  encodedRowRef: string;
  key: string;
  expected: Context;
  now?: () => Date;
}): RowRefData {
  const rowRef = open({
    token: input.encodedRowRef,
    kind: 'row-ref',
    key: input.key,
    expected: input.expected
  });
  if (!validateRowRef(rowRef)) throw cursorError();
  assertNotExpired(rowRef, (input.now ?? (() => new Date()))());
  assertContextMatches(rowRef, input.expected);
  return rowRef;
}
