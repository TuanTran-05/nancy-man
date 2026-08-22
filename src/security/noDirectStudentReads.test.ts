import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe('student browser read boundary', () => {
  it('does not directly read the students collection from production frontend source', () => {
    const offenders = sourceFiles('src').filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /collection\s*\(\s*db\s*,\s*['"]students['"]/.test(source) ||
        /doc\s*\(\s*db\s*,\s*['"]students['"]/.test(source) ||
        /collection\s*:\s*['"]students['"]/.test(source) ||
        /\buseLiveStudents\b/.test(source)
      );
    });

    expect(offenders).toEqual([]);
  });
});
