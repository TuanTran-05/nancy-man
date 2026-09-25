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
const ROW_REF_BINARY_TAG = '$databaseExplorerBinaryV1';
const ROW_REF_DATE_TAG = '$databaseExplorerDateV1';
const ROW_REF_PREFLIGHT_PLAINTEXT_BYTES =
  Math.floor(
    (MAX_CURSOR_BYTES -
      Buffer.byteLength(
        [ENVELOPE_VERSION, 'row-ref', '0'.repeat(16), '', '0'.repeat(22)].join('.'),
        'utf8'
      )) *
      0.75
  ) - 16;
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

function validateRowRefShape(value: unknown): value is RowRefData {
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

function isRowRefScalar(value: unknown): value is null | boolean | number | string {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function canonicalDateIso(value: Date): string | null {
  try {
    if (!Number.isFinite(Date.prototype.getTime.call(value))) return null;
    return Date.prototype.toISOString.call(value);
  } catch {
    return null;
  }
}

function isValidRowRefDate(value: unknown): value is Date {
  return value instanceof Date && canonicalDateIso(value) !== null;
}

function validateRowRef(value: unknown): value is RowRefData {
  if (!validateRowRefShape(value)) return false;
  return Object.values(value.keys).every(
    (claim) => isRowRefScalar(claim) || Buffer.isBuffer(claim) || isValidRowRefDate(claim)
  );
}

function jsonStringByteLength(value: string, maximumBytes: number): number | null {
  let bytes = 2; // surrounding JSON quotes
  if (bytes > maximumBytes) return null;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes) return null;
  }

  return bytes;
}

function jsonValueByteLength(value: unknown, maximumBytes: number): number | null {
  if (value === null) return maximumBytes >= 4 ? 4 : null;
  if (typeof value === 'boolean') {
    const bytes = value ? 4 : 5;
    return maximumBytes >= bytes ? bytes : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    return maximumBytes >= bytes ? bytes : null;
  }
  if (typeof value === 'string') return jsonStringByteLength(value, maximumBytes);
  if (value instanceof Date) {
    const iso = canonicalDateIso(value);
    if (iso === null) return null;
    const tagKeyBytes = Buffer.byteLength(JSON.stringify(ROW_REF_DATE_TAG), 'utf8');
    const dateBytes = jsonStringByteLength(iso, maximumBytes - tagKeyBytes - 3);
    if (dateBytes === null) return null;
    return 2 + tagKeyBytes + 1 + dateBytes;
  }
  if (Buffer.isBuffer(value)) {
    const base64Bytes = Math.ceil(value.byteLength / 3) * 4;
    const tagBytes =
      2 + Buffer.byteLength(JSON.stringify(ROW_REF_BINARY_TAG), 'utf8') + 1 + 2 + base64Bytes;
    return maximumBytes >= tagBytes ? tagBytes : null;
  }
  return null;
}

function jsonObjectByteLength(
  properties: Array<[string, number]>,
  maximumBytes: number
): number | null {
  let bytes = 2; // braces
  for (let index = 0; index < properties.length; index++) {
    const property = properties[index]!;
    const separatorBytes = index > 0 ? 1 : 0;
    if (bytes + separatorBytes > maximumBytes) return null;
    const keyBytes = jsonStringByteLength(property[0], maximumBytes - bytes - separatorBytes - 1);
    if (keyBytes === null) return null;
    bytes += separatorBytes + keyBytes + 1 + property[1]; // comma, key, colon, value
    if (bytes > maximumBytes) return null;
  }
  return bytes;
}

function estimateRowRefPlaintextBytes(rowRef: RowRefData): number | null {
  const budget = ROW_REF_PREFLIGHT_PLAINTEXT_BYTES;
  let keysBytes = 2; // braces
  let keyCount = 0;
  for (const [column, claim] of Object.entries(rowRef.keys)) {
    const separatorBytes = keyCount > 0 ? 1 : 0;
    const columnBytes = jsonStringByteLength(column, budget - keysBytes - separatorBytes - 2);
    if (columnBytes === null) return null;
    const claimBytes = jsonValueByteLength(
      claim,
      budget - keysBytes - separatorBytes - columnBytes - 2
    );
    if (claimBytes === null) return null;
    keysBytes += separatorBytes + columnBytes + 1 + claimBytes;
    if (keysBytes > budget) return null;
    keyCount++;
  }

  const fixedProperties: Array<[string, number]> = [
    ['version', 1],
    ['targetId', jsonStringByteLength(rowRef.targetId, budget) ?? budget + 1],
    ['schema', jsonStringByteLength(rowRef.schema, budget) ?? budget + 1],
    ['relation', jsonStringByteLength(rowRef.relation, budget) ?? budget + 1],
    ['checksum', jsonStringByteLength(rowRef.checksum, budget) ?? budget + 1],
    ['issuedAt', jsonValueByteLength(rowRef.issuedAt, budget) ?? budget + 1],
    ['expiresAt', jsonValueByteLength(rowRef.expiresAt, budget) ?? budget + 1],
    ['keys', keysBytes]
  ];
  return jsonObjectByteLength(fixedProperties, budget);
}

function rowRefPayloadForEncryption(rowRef: RowRefData): unknown {
  const keys = Object.fromEntries(
    Object.entries(rowRef.keys).map(([column, claim]) => {
      if (Buffer.isBuffer(claim)) {
        return [column, { [ROW_REF_BINARY_TAG]: claim.toString('base64') }];
      }
      if (claim instanceof Date) {
        const iso = canonicalDateIso(claim);
        if (iso === null) throw cursorError();
        return [column, { [ROW_REF_DATE_TAG]: iso }];
      }
      return [column, claim];
    })
  );
  return { ...rowRef, keys };
}

function reviveRowRefPayload(value: unknown): RowRefData | null {
  if (!validateRowRefShape(value)) return null;
  const keys: Record<string, unknown> = {};
  for (const [column, claim] of Object.entries(value.keys)) {
    if (isRowRefScalar(claim)) {
      keys[column] = claim;
      continue;
    }
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return null;
    const entries = Object.entries(claim);
    if (entries.length !== 1 || typeof entries[0]?.[1] !== 'string') return null;
    if (entries[0][0] === ROW_REF_BINARY_TAG) {
      const base64 = entries[0][1];
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.toString('base64') !== base64) return null;
      keys[column] = bytes;
      continue;
    }
    if (entries[0][0] === ROW_REF_DATE_TAG) {
      const iso = entries[0][1];
      const timestamp = Date.parse(iso);
      if (!Number.isFinite(timestamp)) return null;
      const date = new Date(timestamp);
      if (canonicalDateIso(date) !== iso) return null;
      keys[column] = date;
      continue;
    }
    return null;
  }
  return { ...value, keys };
}

function rowRefTokenOverheadBytes(): number {
  return Buffer.byteLength(
    [ENVELOPE_VERSION, 'row-ref', '0'.repeat(16), '', '0'.repeat(22)].join('.'),
    'utf8'
  );
}

function seal(kind: TokenKind, value: CursorData | RowRefData, key: string): string;
function seal(
  kind: TokenKind,
  value: CursorData | RowRefData,
  key: string,
  returnNullOnOversize: true
): string | null;
function seal(
  kind: TokenKind,
  value: CursorData | RowRefData,
  key: string,
  returnNullOnOversize = false
): string | null {
  if (!validateContext(value)) throw cursorError();
  let plaintext: string;
  try {
    plaintext = JSON.stringify(
      kind === 'row-ref' ? rowRefPayloadForEncryption(value as RowRefData) : value
    );
  } catch {
    throw cursorError();
  }
  if (!plaintext) throw cursorError();

  const plaintextBytes = Buffer.byteLength(plaintext, 'utf8');
  const remainder = plaintextBytes % 3;
  const ciphertextTextBytes =
    Math.floor(plaintextBytes / 3) * 4 + (remainder === 0 ? 0 : remainder + 1);
  const tokenOverheadBytes =
    kind === 'row-ref'
      ? rowRefTokenOverheadBytes()
      : Buffer.byteLength(
          [ENVELOPE_VERSION, kind, '0'.repeat(16), '', '0'.repeat(22)].join('.'),
          'utf8'
        );
  if (tokenOverheadBytes + ciphertextTextBytes > MAX_CURSOR_BYTES) {
    if (returnNullOnOversize) return null;
    throw cursorError();
  }

  try {
    const nonce = randomBytes(12);
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
    if (Buffer.byteLength(token, 'utf8') > MAX_CURSOR_BYTES) {
      if (returnNullOnOversize) return null;
      throw cursorError();
    }
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
  const encoded = encodeRowRefIfWithinLimit(rowRef, key);
  if (encoded === null) throw cursorError();
  return encoded;
}

export function encodeRowRefIfWithinLimit(rowRef: RowRefData, key: string): string | null {
  if (!validateRowRefShape(rowRef)) throw cursorError();
  if (estimateRowRefPlaintextBytes(rowRef) === null) return null;
  return seal('row-ref', rowRef, key, true);
}

export function decodeRowRef(input: {
  encodedRowRef: string;
  key: string;
  expected: Context;
  now?: () => Date;
}): RowRefData {
  const opened = open({
    token: input.encodedRowRef,
    kind: 'row-ref',
    key: input.key,
    expected: input.expected
  });
  const rowRef = reviveRowRefPayload(opened);
  if (!validateRowRef(rowRef)) throw cursorError();
  assertNotExpired(rowRef, (input.now ?? (() => new Date()))());
  assertContextMatches(rowRef, input.expected);
  return rowRef;
}
