import { describe, expect, it } from 'vitest';

import { PostgresSourceMapStorage } from './postgresSourceMapStorage.js';

describe('PostgresSourceMapStorage', () => {
  it('resolves a map by service, release and generated filename before reading its private object', async () => {
    const queries: Array<{ sql: string; parameters?: readonly unknown[] | undefined }> = [];
    const storage = new PostgresSourceMapStorage(
      {
        query: async <T>(sql: string, parameters?: readonly unknown[]) => {
          queries.push({ sql, parameters });
          return {
            rows: [
              {
                objectKey:
                  'source-maps/edutrack-web/0123456789abcdef0123456789abcdef01234567/map.map',
                sha256: 'a'.repeat(64)
              }
            ] as T[]
          };
        }
      },
      {
        get: async (objectKey) => (objectKey.includes('edutrack-web') ? '{"version":3}' : null)
      }
    );

    await expect(
      storage.find({
        serviceName: 'edutrack-web',
        release: '0123456789abcdef0123456789abcdef01234567',
        generatedFile: 'app-abc123.js'
      })
    ).resolves.toEqual({ content: '{"version":3}', sha256: 'a'.repeat(64) });
    expect(queries[0]).toMatchObject({
      sql: expect.stringContaining('JOIN releases'),
      parameters: ['edutrack-web', '0123456789abcdef0123456789abcdef01234567', 'app-abc123.js']
    });
  });

  it('returns unavailable when the object metadata exists but its private file does not', async () => {
    const storage = new PostgresSourceMapStorage(
      {
        query: async <T>() => ({
          rows: [{ objectKey: 'missing.map', sha256: 'a'.repeat(64) }] as T[]
        })
      },
      { get: async () => null }
    );

    await expect(
      storage.find({ serviceName: 'edutrack-web', release: 'release', generatedFile: 'app.js' })
    ).resolves.toBeNull();
  });
});
