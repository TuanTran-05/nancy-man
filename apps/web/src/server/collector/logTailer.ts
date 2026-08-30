import { readFileSync, statSync } from 'node:fs';

export interface FileCursor {
  inode: number;
  offset: number;
}

export interface TailResult {
  lines: string[];
  cursor: FileCursor;
  startedAtEnd: boolean;
}

export function tailSinceCursor(path: string, cursor?: FileCursor): TailResult {
  const stat = statSync(path);
  const inode = Number(stat.ino);
  const size = stat.size;
  const rotated = !cursor || cursor.inode !== inode;
  const startAtEnd = rotated && !cursor;
  let offset =
    rotated || (cursor && cursor.offset > size) ? (startAtEnd ? size : 0) : cursor.offset;
  if (offset < 0) offset = 0;
  if (offset >= size)
    return { lines: [], cursor: { inode, offset: size }, startedAtEnd: startAtEnd };
  const bytes = readFileSync(path).subarray(offset);
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  const completeCount = text.endsWith('\n') ? lines.length - 1 : Math.max(0, lines.length - 1);
  const completeLines = lines.slice(0, completeCount);
  const consumedBytes = Buffer.byteLength(
    completeLines.length ? `${completeLines.join('\n')}\n` : '',
    'utf8'
  );
  return {
    lines: completeLines,
    cursor: { inode, offset: offset + consumedBytes },
    startedAtEnd: false
  };
}
