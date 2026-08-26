import { Buffer } from 'node:buffer';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

function normalizeValue(value: unknown, seen: WeakSet<object>, depth = 0): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value !== 'object' || depth >= 10) return '[Unsupported result value]';
  if (seen.has(value)) return '[Circular result value]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => normalizeValue(item, seen, depth + 1));
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = normalizeValue(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function encodeBoundedRows(input: { rows: unknown[]; maxBytes: number }): {
  rows: JsonValue[];
  encodedBytes: number;
  truncated: boolean;
} {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 2) {
    throw new Error('SQL_RESULT_BYTE_LIMIT_INVALID');
  }
  const rows: JsonValue[] = [];
  let encodedBytes = 2;
  for (const row of input.rows) {
    const encoded = normalizeValue(row, new WeakSet());
    const rowBytes = Buffer.byteLength(JSON.stringify(encoded), 'utf8');
    const nextBytes = encodedBytes + rowBytes + (rows.length === 0 ? 0 : 1);
    if (nextBytes > input.maxBytes) return { rows, encodedBytes, truncated: true };
    rows.push(encoded);
    encodedBytes = nextBytes;
  }
  return { rows, encodedBytes, truncated: false };
}
