import { createHash } from 'node:crypto';

import { SourceMapGenerator } from 'source-map';
import { describe, expect, it } from 'vitest';

import { SourceMapService } from './sourceMapService.js';

function createMap(): string {
  const generator = new SourceMapGenerator({ file: 'app.min.js' });
  generator.addMapping({
    generated: { line: 1, column: 10 },
    original: { line: 42, column: 9 },
    source: 'src/pages/Students.tsx',
    name: 'loadStudents'
  });
  return generator.toString();
}

describe('SourceMapService', () => {
  it('symbolicates matching release frames after checksum verification', async () => {
    const map = createMap();
    const service = new SourceMapService({
      find: async ({ release, generatedFile }) =>
        release === 'release-1' && generatedFile === 'app.min.js'
          ? {
              content: map,
              sha256: createHash('sha256').update(map, 'utf8').digest('hex')
            }
          : null
    });

    await expect(
      service.symbolicate({
        release: 'release-1',
        stack: 'TypeError: failed\n    at a (https://thienuy.edu.vn/assets/app.min.js:1:10)'
      })
    ).resolves.toEqual({
      status: 'symbolicated',
      stackFrames: ['loadStudents (src/pages/Students.tsx:42:9)']
    });
  });

  it('preserves safe generated frames instead of trusting a source map with a bad checksum', async () => {
    const map = createMap();
    const service = new SourceMapService({
      find: async () => ({ content: map, sha256: '0'.repeat(64) })
    });

    await expect(
      service.symbolicate({
        release: 'release-1',
        stack: 'TypeError: failed\n    at a (https://thienuy.edu.vn/assets/app.min.js:1:10)'
      })
    ).resolves.toEqual({
      status: 'checksum_mismatch',
      stackFrames: ['a (https://thienuy.edu.vn/assets/app.min.js:1:10)']
    });
  });
});
