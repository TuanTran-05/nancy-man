import { describe, expect, it } from 'vitest';
import { encodeCell, encodeRowPage, MAX_CELL_BYTES, MAX_RESPONSE_BYTES } from './valueEncoding.js';
import type { DatabaseExplorerColumn } from '../../../../packages/contracts/src/databaseExplorer.js';

function createMockColumn(overrides: Partial<DatabaseExplorerColumn> = {}): DatabaseExplorerColumn {
  return {
    name: 'col',
    dataType: 'text',
    nullable: true,
    hasDefault: false,
    identity: null,
    generated: false,
    classification: 'internal',
    selectable: true,
    filterOperators: ['eq', 'neq'],
    ...overrides
  };
}

describe('valueEncoding', () => {
  it('encodes blocked columns as state: "blocked"', () => {
    const col = createMockColumn({
      name: 'password_hash',
      classification: 'blocked',
      selectable: false
    });
    const cell = encodeCell({
      columnName: 'password_hash',
      column: col,
      rawValue: 'secret_hash_value',
      piiMode: 'masked'
    });
    expect(cell).toEqual({ state: 'blocked' });

    // Even in revealed mode, blocked columns are never revealed
    const cellRevealed = encodeCell({
      columnName: 'password_hash',
      column: col,
      rawValue: 'secret_hash_value',
      piiMode: 'revealed'
    });
    expect(cellRevealed).toEqual({ state: 'blocked' });
  });

  it('masks PII columns when piiMode is "masked"', () => {
    const emailCol = createMockColumn({ name: 'email', classification: 'pii' });
    const cell = encodeCell({
      columnName: 'email',
      column: emailCol,
      rawValue: 'student@example.com',
      piiMode: 'masked'
    });
    expect(cell.state).toBe('masked');
    if (cell.state === 'masked') {
      expect(cell.display).not.toContain('student@example.com');
      expect(cell.display).toBe('s***@example.com');
    }
  });

  it('reveals PII columns only when piiMode is "revealed"', () => {
    const emailCol = createMockColumn({ name: 'email', classification: 'pii' });
    const cell = encodeCell({
      columnName: 'email',
      column: emailCol,
      rawValue: 'student@example.com',
      piiMode: 'revealed'
    });
    expect(cell).toEqual({ state: 'value', value: 'student@example.com' });
  });

  it('encodes null values safely', () => {
    const col = createMockColumn({ name: 'description' });
    const cell = encodeCell({
      columnName: 'description',
      column: col,
      rawValue: null,
      piiMode: 'masked'
    });
    expect(cell).toEqual({ state: 'value', value: null });
  });

  it('truncates scalar values larger than 64 KiB', () => {
    const col = createMockColumn({ name: 'large_payload' });
    const bigString = 'x'.repeat(MAX_CELL_BYTES + 100);
    const cell = encodeCell({
      columnName: 'large_payload',
      column: col,
      rawValue: bigString,
      piiMode: 'masked'
    });

    expect(cell.state).toBe('truncated');
    if (cell.state === 'truncated') {
      expect(cell.originalBytes).toBe(MAX_CELL_BYTES + 100);
      expect(cell.display.length).toBeLessThan(600);
      expect(cell.display.endsWith('...')).toBe(true);
    }
  });

  it('represents bytea by size and SHA-256 digest, not raw bytes', () => {
    const byteaCol = createMockColumn({ name: 'file_data', dataType: 'bytea' });
    const rawBuffer = Buffer.from('hello bytea content');
    const cell = encodeCell({
      columnName: 'file_data',
      column: byteaCol,
      rawValue: rawBuffer,
      piiMode: 'masked'
    });

    expect(cell.state).toBe('value');
    if (cell.state === 'value') {
      expect(typeof cell.value).toBe('string');
      expect(cell.value).toMatch(/<bytea: 19 bytes, sha256: [0-9a-f]{64}>/);
      expect(cell.value).not.toContain('hello bytea content');
    }
  });

  it('bounds response size and stops before 2 MiB with truncated: true', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      rowRef: `ref_${i}`,
      cells: {
        id: { state: 'value' as const, value: `id_${i}` },
        payload: { state: 'value' as const, value: 'y'.repeat(60_000) } // 60 KB per row
      }
    }));

    const result = encodeRowPage(rows, MAX_RESPONSE_BYTES);
    expect(result.encodedBytes).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeLessThan(50);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
