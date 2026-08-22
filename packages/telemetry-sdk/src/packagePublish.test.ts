import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as {
  files?: string[];
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
  types?: string;
};

describe('telemetry SDK publish contract', () => {
  it('builds an emitted self-contained dist tree that npm pack can include', () => {
    expect(packageJson.files).toEqual(['dist']);
    expect(packageJson.scripts?.build).toContain('tsconfig.publish.json');
    expect(packageJson.exports?.['.']).toBe('./dist/telemetry-sdk/src/index.js');
    expect(packageJson.types).toBe('./dist/telemetry-sdk/src/index.d.ts');
  });
});
