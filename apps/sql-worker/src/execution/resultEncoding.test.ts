import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { encodeBoundedRows } from './resultEncoding.js';

describe('encodeBoundedRows', () => {
  it('returns only complete rows that fit within the result-byte budget', () => {
    const first = { label: 'ok' };
    const firstBytes = Buffer.byteLength(JSON.stringify([first]), 'utf8');

    const result = encodeBoundedRows({
      rows: [first, { label: 'this row must not be partially returned' }],
      maxBytes: firstBytes
    });

    expect(result).toEqual({ rows: [first], encodedBytes: firstBytes, truncated: true });
  });

  it('normalizes result values into JSON-safe data without leaking Buffer internals', () => {
    const result = encodeBoundedRows({
      rows: [
        {
          createdAt: new Date('2026-08-22T10:00:00.000Z'),
          attachment: Buffer.from('ab', 'utf8'),
          nested: { active: true }
        }
      ],
      maxBytes: 1_024
    });

    expect(result).toMatchObject({
      rows: [
        {
          createdAt: '2026-08-22T10:00:00.000Z',
          attachment: '\\x6162',
          nested: { active: true }
        }
      ],
      truncated: false
    });
    expect(JSON.stringify(result)).not.toContain('Buffer');
  });
});
