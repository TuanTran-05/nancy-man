import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  decodeRowRef,
  encodeCursor,
  encodeRowRef,
  type KeysetCursorData,
  type OffsetCursorData,
  type RowRefData
} from './cursorCodec.js';

describe('cursorCodec', () => {
  const testKey = Buffer.alloc(32, 11).toString('base64');
  const wrongKey = Buffer.alloc(32, 12).toString('base64');

  const baseKeysetCursor = {
    version: 1,
    kind: 'keyset',
    targetId: 'edutrack_production',
    schema: 'public',
    relation: 'students',
    checksum: 'mock_checksum_123',
    issuedAt: 1000,
    expiresAt: 1000 + 5 * 60 * 1000,
    keys: [{ column: 'id', value: 'std_100' }],
    sort: { column: 'email', direction: 'asc' },
    nullOrder: 'last'
  } as KeysetCursorData & { nullOrder: 'last' };

  const expectedContext = {
    targetId: 'edutrack_production' as const,
    schema: 'public',
    relation: 'students',
    checksum: 'mock_checksum_123'
  };

  it('encodes and decodes keyset cursor successfully', () => {
    const encoded = encodeCursor(baseKeysetCursor, testKey);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeLessThan(4096);

    const decoded = decodeCursor({
      encodedCursor: encoded,
      key: testKey,
      expected: expectedContext,
      now: () => new Date(1000 + 60 * 1000)
    });

    expect(decoded).toEqual(baseKeysetCursor);
  });

  it('keeps sort values and row-reference foreign-key values confidential', () => {
    const sortMarker = 'known-sort-value-7b2c';
    const fkMarker = 'known-foreign-key-value-1e9a';
    const cursor = encodeCursor(
      { ...baseKeysetCursor, keys: [{ column: 'email', value: sortMarker }] },
      testKey
    );
    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        checksum: 'mock_checksum_123',
        issuedAt: 1000,
        expiresAt: 301_000,
        keys: { student_id: fkMarker }
      } as RowRefData,
      testKey
    );
    const decodedSegments = [cursor, rowRef]
      .flatMap((token) => token.split('.'))
      .map((segment) => Buffer.from(segment, 'base64url').toString('utf8'));

    expect(decodedSegments.join('\n')).not.toContain(sortMarker);
    expect(decodedSegments.join('\n')).not.toContain(fkMarker);
  });

  it('encodes and decodes offset cursor successfully', () => {
    const offsetCursor = {
      version: 1,
      kind: 'offset',
      targetId: 'ops',
      schema: 'public',
      relation: 'audit_logs',
      checksum: 'ops_checksum_456',
      issuedAt: 2000,
      expiresAt: 2000 + 5 * 60 * 1000,
      offset: 50,
      sort: null,
      nullOrder: 'last'
    } as OffsetCursorData & { sort: null; nullOrder: 'last' };

    const encoded = encodeCursor(offsetCursor, testKey);
    const decoded = decodeCursor({
      encodedCursor: encoded,
      key: testKey,
      expected: {
        targetId: 'ops',
        schema: 'public',
        relation: 'audit_logs',
        checksum: 'ops_checksum_456'
      },
      now: () => new Date(2000 + 30 * 1000)
    });

    expect(decoded).toEqual(offsetCursor);
  });

  it('rejects tampered cursor with DATABASE_CURSOR_INVALID', () => {
    const encoded = encodeCursor(baseKeysetCursor, testKey);
    const tampered = encoded.slice(0, -4) + 'abcd';

    expect(() =>
      decodeCursor({
        encodedCursor: tampered,
        key: testKey,
        expected: expectedContext,
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects cursor signed with a different key', () => {
    const encoded = encodeCursor(baseKeysetCursor, wrongKey);

    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: expectedContext,
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects cursor expired beyond 5 minutes', () => {
    const encoded = encodeCursor(baseKeysetCursor, testKey);

    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: expectedContext,
        // 5 min and 1 second after issue
        now: () => new Date(baseKeysetCursor.expiresAt + 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects a row reference after its five-minute expiry', () => {
    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        checksum: 'mock_checksum_123',
        issuedAt: 1000,
        expiresAt: 301_000,
        keys: { id: 'std_123' }
      } as RowRefData,
      testKey
    );

    expect(() =>
      decodeRowRef({ encodedRowRef: rowRef, key: testKey, expected: expectedContext })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects row references with a different key or context', () => {
    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        checksum: 'mock_checksum_123',
        issuedAt: 1000,
        expiresAt: 301_000,
        keys: { student_id: 'fk-marker' }
      },
      testKey
    );

    expect(() =>
      decodeRowRef({
        encodedRowRef: rowRef,
        key: wrongKey,
        expected: expectedContext,
        now: () => new Date(61_000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
    expect(() =>
      decodeRowRef({
        encodedRowRef: rowRef,
        key: testKey,
        expected: { ...expectedContext, relation: 'attendance' },
        now: () => new Date(61_000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects cursor when targetId, schema, relation, or checksum mismatch', () => {
    const encoded = encodeCursor(baseKeysetCursor, testKey);

    // Wrong target
    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: { ...expectedContext, targetId: 'ops' },
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);

    // Wrong schema
    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: { ...expectedContext, schema: 'internal' },
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);

    // Wrong relation
    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: { ...expectedContext, relation: 'teachers' },
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);

    // Wrong checksum (schema drift)
    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: { ...expectedContext, checksum: 'newer_checksum_789' },
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects cursor larger than 4 KiB (4096 bytes)', () => {
    const hugeKeys = Array.from({ length: 200 }, (_, i) => ({
      column: `col_${i}`,
      value: 'x'.repeat(50)
    }));

    const hugeCursor = {
      ...baseKeysetCursor,
      keys: hugeKeys
    } as KeysetCursorData & { nullOrder: 'last' };

    expect(() => encodeCursor(hugeCursor, testKey)).toThrowError(/DATABASE_CURSOR_INVALID/);

    const oversizedString = 'a'.repeat(4097);
    expect(() =>
      decodeCursor({
        encodedCursor: oversizedString,
        key: testKey,
        expected: expectedContext,
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects row references larger than 4 KiB on encode and decode', () => {
    const hugeRowRef = {
      version: 1 as const,
      ...expectedContext,
      issuedAt: 1000,
      expiresAt: 301_000,
      keys: { marker: 'x'.repeat(5000) }
    };

    expect(() => encodeRowRef(hugeRowRef, testKey)).toThrowError(/DATABASE_CURSOR_INVALID/);
    expect(() =>
      decodeRowRef({
        encodedRowRef: 'a'.repeat(4097),
        key: testKey,
        expected: expectedContext,
        now: () => new Date(61_000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });

  it('rejects offset beyond 10,000 rows with DATABASE_PAGE_TOO_LARGE', () => {
    const excessiveOffsetCursor = {
      version: 1,
      kind: 'offset',
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      checksum: 'mock_checksum_123',
      issuedAt: 1000,
      expiresAt: 1000 + 5 * 60 * 1000,
      offset: 10_001,
      sort: null,
      nullOrder: 'last'
    } as OffsetCursorData & { sort: null; nullOrder: 'last' };

    const encoded = encodeCursor(excessiveOffsetCursor, testKey);

    expect(() =>
      decodeCursor({
        encodedCursor: encoded,
        key: testKey,
        expected: expectedContext,
        now: () => new Date(1000 + 60 * 1000)
      })
    ).toThrowError(/DATABASE_PAGE_TOO_LARGE/);
  });

  it('encodes and decodes rowRef successfully and rejects tampering', () => {
    const rowRefData = {
      version: 1,
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      checksum: 'mock_checksum_123',
      issuedAt: 1000,
      expiresAt: 301_000,
      keys: { id: 'std_123', school_id: 42 }
    } as RowRefData & { issuedAt: number; expiresAt: number };

    const encoded = encodeRowRef(rowRefData, testKey);
    expect(typeof encoded).toBe('string');

    const decoded = decodeRowRef({
      encodedRowRef: encoded,
      key: testKey,
      expected: expectedContext,
      now: () => new Date(61_000)
    });

    expect(decoded).toEqual(rowRefData);

    // Tampered rowRef
    expect(() =>
      decodeRowRef({
        encodedRowRef: encoded.slice(0, -4) + 'zzzz',
        key: testKey,
        expected: expectedContext,
        now: () => new Date(61_000)
      })
    ).toThrowError(/DATABASE_CURSOR_INVALID/);
  });
});
