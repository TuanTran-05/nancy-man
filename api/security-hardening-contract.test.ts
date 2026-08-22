import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const wildcardCorsHeaderPattern = /Access-Control-Allow-Origin['"]\s*,\s*['"]\*/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe('security hardening contracts', () => {
  it('detects wildcard CORS setHeader syntax', () => {
    expect(
      wildcardCorsHeaderPattern.test("res.setHeader('Access-Control-Allow-Origin', '*')")
    ).toBe(true);
  });

  it('does not use wildcard API CORS headers in production API routes', () => {
    const offenders = sourceFiles('api').filter((file) => {
      const source = readFileSync(file, 'utf8');
      return wildcardCorsHeaderPattern.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('does not push production realtime deltas to role or class paths', () => {
    const offenders = sourceFiles('server').filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /['"`]role:admin['"`]/.test(source) || /`class:\$\{/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
