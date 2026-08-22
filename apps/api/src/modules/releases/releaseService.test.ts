import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { registerRelease } from './releaseService.js';

const map = JSON.stringify({
  version: 3,
  sources: ['src/App.tsx'],
  names: [],
  mappings: '',
  file: 'app.js'
});
const sha256 = createHash('sha256').update(map, 'utf8').digest('hex');

describe('registerRelease', () => {
  it('stores verified source maps privately and accepts an identical retry idempotently', async () => {
    const objects = new Map<string, string>();
    const registered: unknown[] = [];
    const input = {
      serviceName: 'edutrack-web',
      releaseSha: '0123456789abcdef0123456789abcdef01234567',
      buildId: 'build-1',
      deployedAt: '2026-08-22T08:00:00.000Z',
      sourceMaps: [{ generatedFile: 'assets/app.js', content: map, sha256 }]
    };
    const dependencies = {
      objectStore: {
        putIfAbsent: async (objectKey: string, content: string, digest: string) => {
          const previous = objects.get(objectKey);
          if (previous && previous !== digest) return 'conflict' as const;
          objects.set(objectKey, digest);
          expect(createHash('sha256').update(content, 'utf8').digest('hex')).toBe(digest);
          return previous ? ('identical' as const) : ('created' as const);
        }
      },
      repository: {
        upsertRelease: async (release: unknown) => {
          registered.push(release);
          return { id: '8421cc33-1770-4b9c-82d8-82d8c54da83f' };
        },
        recordSourceMap: async () => undefined
      }
    };

    await expect(registerRelease(input, dependencies)).resolves.toEqual({
      releaseId: expect.any(String)
    });
    await expect(registerRelease(input, dependencies)).resolves.toEqual({
      releaseId: expect.any(String)
    });
    expect(registered).toHaveLength(2);
  });

  it('rejects an altered map before it reaches object storage', async () => {
    await expect(
      registerRelease(
        {
          serviceName: 'edutrack-web',
          releaseSha: '0123456789abcdef0123456789abcdef01234567',
          buildId: 'build-1',
          deployedAt: '2026-08-22T08:00:00.000Z',
          sourceMaps: [{ generatedFile: 'assets/app.js', content: map, sha256: '0'.repeat(64) }]
        },
        {
          objectStore: { putIfAbsent: async () => 'created' as const },
          repository: {
            upsertRelease: async () => ({ id: 'unused' }),
            recordSourceMap: async () => undefined
          }
        }
      )
    ).rejects.toThrow(/checksum/i);
  });
});
