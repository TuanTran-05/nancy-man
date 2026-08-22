import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) return tsxFilesUnder(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('dropdown alignment styles', () => {
  it('keeps every native dropdown and dropdown option left aligned globally', () => {
    const css = readFileSync('src/index.css', 'utf8');

    expect(css).toMatch(/select,\s*option\s*\{[^}]*text-align:\s*left\s*!important;/s);
    expect(css).toMatch(/select\s*\{[^}]*text-align-last:\s*left\s*!important;/s);
  });

  it('does not repeat dropdown alignment classes in individual components', () => {
    const redundantAlignments = tsxFilesUnder('src').flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return Array.from(
        source.matchAll(
          /<(select|option)\b[^>]*className\s*=\s*(?:"[^"]*\btext-left\b[^"]*"|'[^']*\btext-left\b[^']*'|\{`[^`]*\btext-left\b[^`]*`\})/gs
        )
      ).map((match) => ({ file, tag: match[1], snippet: match[0].replace(/\s+/g, ' ') }));
    });

    expect(redundantAlignments).toEqual([]);
  });
});
