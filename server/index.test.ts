import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isServerEntrypoint } from './index.js';

describe('isServerEntrypoint', () => {
  const serverPath = '/srv/edutrack/current/dist-server/index.js';
  const serverUrl = pathToFileURL(serverPath).href;

  it('recognizes direct Node execution', () => {
    expect(isServerEntrypoint(serverUrl, serverPath, undefined)).toBe(true);
  });

  it('recognizes the PM2-managed script through pm_exec_path', () => {
    expect(
      isServerEntrypoint(serverUrl, '/usr/lib/node_modules/pm2/ProcessContainerFork.js', serverPath)
    ).toBe(true);
  });

  it('resolves the current-release symlink used by PM2', () => {
    const currentPath = '/srv/edutrack/current/dist-server/index.js';
    const releasePath = '/srv/edutrack/releases/20260819-vps2/dist-server/index.js';

    expect(
      isServerEntrypoint(
        pathToFileURL(releasePath).href,
        '/usr/lib/node_modules/pm2/ProcessContainerFork.js',
        currentPath,
        () => releasePath
      )
    ).toBe(true);
  });

  it('does not start when imported by another process', () => {
    expect(isServerEntrypoint(serverUrl, '/workspace/tests/runner.js', undefined)).toBe(false);
  });
});
