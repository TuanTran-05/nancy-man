import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Audit payload must contain finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Audit payload must contain JSON-compatible values');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export function canonicalizeAuditPayload(payload: Record<string, unknown>): string {
  return canonicalize(payload);
}

export function createAuditEntryHash(input: {
  previousHash: string | null;
  payload: Record<string, unknown>;
}): string {
  if (input.previousHash !== null && !/^[a-f0-9]{64}$/.test(input.previousHash)) {
    throw new Error('Audit previous hash is invalid');
  }
  return createHash('sha256')
    .update(`${input.previousHash ?? 'ROOT'}\n${canonicalizeAuditPayload(input.payload)}`, 'utf8')
    .digest('hex');
}
