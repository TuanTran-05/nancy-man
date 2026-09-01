import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { isConfigAgentEntrypoint } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('isConfigAgentEntrypoint', () => {
  it('recognizes an executable reached through the immutable current symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'config-agent-entrypoint-'));
    temporaryDirectories.push(directory);
    const releaseDirectory = join(directory, 'releases', 'verified-sha');
    mkdirSync(releaseDirectory, { recursive: true });
    const executable = join(releaseDirectory, 'index.js');
    writeFileSync(executable, 'export {};\n');
    const current = join(directory, 'current');
    symlinkSync(releaseDirectory, current);
    const linkedExecutable = join(current, 'index.js');

    expect(
      isConfigAgentEntrypoint(linkedExecutable, pathToFileURL(realpathSync(executable)).href)
    ).toBe(true);
    expect(isConfigAgentEntrypoint(undefined, pathToFileURL(executable).href)).toBe(false);
  });
});
