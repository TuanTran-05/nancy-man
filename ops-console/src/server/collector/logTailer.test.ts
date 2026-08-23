import { appendFileSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { tailSinceCursor } from './logTailer.js';

describe('incremental log tailer', () => {
  it('starts at EOF, then follows appends and handles copytruncate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-tail-'));
    const path = join(directory, 'app.log');
    writeFileSync(path, 'old\n');
    const initial = tailSinceCursor(path);
    expect(initial.lines).toEqual([]);
    appendFileSync(path, 'new\n');
    const appended = tailSinceCursor(path, initial.cursor);
    expect(appended.lines).toEqual(['new']);
    writeFileSync(path, 'x\n');
    const truncated = tailSinceCursor(path, appended.cursor);
    expect(truncated.lines).toEqual(['x']);
  });

  it('resets on inode rotation and does not consume an incomplete final line', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-tail-'));
    const path = join(directory, 'app.log');
    writeFileSync(path, 'one\n');
    const first = tailSinceCursor(path, { inode: 1, offset: 0 });
    expect(first.lines).toEqual(['one']);
    const rotated = join(directory, 'rotated.log');
    renameSync(path, rotated);
    writeFileSync(path, 'two\npartial');
    const next = tailSinceCursor(path, first.cursor);
    expect(next.lines).toEqual(['two']);
    expect(next.cursor.offset).toBe(4);
  });
});
