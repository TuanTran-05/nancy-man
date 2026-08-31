import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  linkSync,
  unlinkSync,
  renameSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { resolveActiveReleaseLink, readSafeSourceFile, SafeSourceError } from './safeSourceFile.js';

const temporaryRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'edutrack-config-agent-'));
  temporaryRoots.push(root);
  return root;
}

function expectedMetadata(path: string, maximumBytes = 1024) {
  const stat = statSync(path);
  return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777, maximumBytes };
}

function read(path: string, expected = expectedMetadata(path)) {
  return readSafeSourceFile({ sourceId: 'test.source', path, expected });
}

afterEach(() => {
  // Test directories are intentionally retained; the OS temp directory owns cleanup.
  temporaryRoots.length = 0;
});

describe('safe source reads', () => {
  test('reads a verified regular file and revalidates its descriptor', () => {
    const root = tempRoot();
    const sourcePath = join(root, 'source.env');
    const bytes = Buffer.from('NAME=value\n', 'utf8');
    writeFileSync(sourcePath, bytes, { mode: 0o640 });

    const result = read(sourcePath);

    expect(result.bytes).toEqual(bytes);
    expect(result.sourceId).toBe('test.source');
    expect(result.metadata.nlink).toBe(1);
  });

  test.each([
    [
      'path traversal',
      () => {
        const root = tempRoot();
        const sourcePath = join(root, 'source.env');
        writeFileSync(sourcePath, 'safe', { mode: 0o640 });
        return readSafeSourceFile({
          sourceId: 'test.source',
          path: `${root}/nested/../source.env`,
          expected: expectedMetadata(sourcePath)
        });
      }
    ],
    [
      'final symlink',
      () => {
        const root = tempRoot();
        const target = join(root, 'target.env');
        const link = join(root, 'source.env');
        writeFileSync(target, 'safe', { mode: 0o640 });
        symlinkSync(target, link);
        return readSafeSourceFile({
          sourceId: 'test.source',
          path: link,
          expected: expectedMetadata(target)
        });
      }
    ],
    [
      'intermediate symlink',
      () => {
        const root = tempRoot();
        const real = join(root, 'real');
        const link = join(root, 'link');
        mkdirSync(real);
        writeFileSync(join(real, 'source.env'), 'safe', { mode: 0o640 });
        symlinkSync(real, link);
        return readSafeSourceFile({
          sourceId: 'test.source',
          path: join(link, 'source.env'),
          expected: expectedMetadata(join(real, 'source.env'))
        });
      }
    ]
  ])('rejects %s', (_name, operation) => {
    expect(operation).toThrowError(expect.objectContaining({ code: expect.any(String) }));
    try {
      operation();
    } catch (error) {
      expect((error as SafeSourceError).code).toBe(
        _name === 'path traversal' ? 'SOURCE_PATH_TRAVERSAL' : 'SOURCE_SYMLINK_REJECTED'
      );
    }
  });

  test('rejects hard links, metadata drift, non-regular files, and oversized files', () => {
    const root = tempRoot();
    const sourcePath = join(root, 'source.env');
    const hardLink = join(root, 'hard.env');
    writeFileSync(sourcePath, 'safe', { mode: 0o640 });
    linkSync(sourcePath, hardLink);
    expect(() => read(sourcePath)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HARD_LINK_REJECTED' })
    );

    unlinkSync(hardLink);
    chmodSync(sourcePath, 0o600);
    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected: { ...expectedMetadata(sourcePath), mode: 0o640 }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_METADATA_DRIFT' }));

    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: root,
        expected: { ...expectedMetadata(sourcePath), mode: 0o755 }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_NOT_REGULAR' }));
    const current = statSync(sourcePath);
    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected: { ...expectedMetadata(sourcePath), uid: current.uid + 1 }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_METADATA_DRIFT' }));
    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected: { ...expectedMetadata(sourcePath), gid: current.gid + 1 }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_METADATA_DRIFT' }));
    writeFileSync(sourcePath, '12345', { mode: 0o640 });
    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected: expectedMetadata(sourcePath, 3)
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LARGE' }));
  });

  test('detects replacement between open and metadata verification', () => {
    const root = tempRoot();
    const sourcePath = join(root, 'source.env');
    const replacementPath = join(root, 'replacement.env');
    writeFileSync(sourcePath, 'before', { mode: 0o640 });
    writeFileSync(replacementPath, 'after', { mode: 0o640 });
    const expected = expectedMetadata(sourcePath);

    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected,
        testHooks: {
          afterOpen: () => {
            unlinkSync(sourcePath);
            renameSync(replacementPath, sourcePath);
          }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_METADATA_DRIFT' }));
  });

  test('rejects growth beyond the declared limit after opening', () => {
    const root = tempRoot();
    const sourcePath = join(root, 'source.env');
    writeFileSync(sourcePath, '123', { mode: 0o640 });
    expect(() =>
      readSafeSourceFile({
        sourceId: 'test.source',
        path: sourcePath,
        expected: expectedMetadata(sourcePath, 3),
        testHooks: {
          afterOpen: () => {
            writeFileSync(sourcePath, '1234');
          }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LARGE' }));
  });
});

describe('active release link resolver', () => {
  function releaseFixture() {
    const root = tempRoot();
    const releasesRoot = join(root, 'releases');
    const release = join(releasesRoot, '20260831-abc');
    const current = join(root, 'current');
    mkdirSync(join(release, 'deploy', 'vps'), { recursive: true });
    writeFileSync(join(release, '.release-metadata.json'), '{"releaseId":"20260831-abc"}\n', {
      mode: 0o640
    });
    writeFileSync(
      join(release, 'deploy', 'vps', 'ecosystem.config.cjs'),
      'module.exports = { apps: [] };\n',
      { mode: 0o640 }
    );
    symlinkSync(release, current);
    return { root, releasesRoot, release, current };
  }

  test('resolves exactly one direct child and fixed descendant with release metadata', () => {
    const fixture = releaseFixture();
    const resolved = resolveActiveReleaseLink({
      sourceId: 'edutrack.pm2_ecosystem',
      currentPath: fixture.current,
      approvedTargetRoot: fixture.releasesRoot,
      fixedDescendant: 'deploy/vps/ecosystem.config.cjs'
    });

    expect(resolved.releasePath).toBe(fixture.release);
    expect(resolved.sourcePath).toBe(
      join(fixture.release, 'deploy', 'vps', 'ecosystem.config.cjs')
    );
    expect(resolved.releaseId).toBe('20260831-abc');
  });

  test.each([
    [
      'nested release target',
      (fixture: ReturnType<typeof releaseFixture>) => {
        const nested = join(fixture.releasesRoot, 'nested', '20260831-abc');
        mkdirSync(join(nested, 'deploy', 'vps'), { recursive: true });
        writeFileSync(join(nested, '.release-metadata.json'), 'nested');
        unlinkSync(fixture.current);
        symlinkSync(nested, fixture.current, 'junction');
      }
    ],
    [
      'relative escape',
      (fixture: ReturnType<typeof releaseFixture>) => {
        const escaped = join(fixture.root, 'outside');
        mkdirSync(escaped);
        unlinkSync(fixture.current);
        symlinkSync('../outside', fixture.current, 'junction');
      }
    ],
    [
      'missing release metadata',
      (fixture: ReturnType<typeof releaseFixture>) => {
        // The resolver must not accept a release directory without its identity file.
        const metadata = join(fixture.release, '.release-metadata.json');
        writeFileSync(metadata, '');
      }
    ],
    [
      'symlink below release',
      (fixture: ReturnType<typeof releaseFixture>) => {
        const target = join(fixture.root, 'outside-ecosystem.cjs');
        const source = join(fixture.release, 'deploy', 'vps', 'ecosystem.config.cjs');
        writeFileSync(target, 'module.exports = { apps: [] };');
        writeFileSync(source, 'replaced');
        unlinkSync(source);
        symlinkSync(target, source);
      }
    ]
  ])('rejects %s', (_name, mutate) => {
    const fixture = releaseFixture();
    mutate(fixture);
    expect(() =>
      resolveActiveReleaseLink({
        sourceId: 'edutrack.pm2_ecosystem',
        currentPath: fixture.current,
        approvedTargetRoot: fixture.releasesRoot,
        fixedDescendant: 'deploy/vps/ecosystem.config.cjs'
      })
    ).toThrowError(expect.objectContaining({ code: expect.any(String) }));
  });

  test('rejects an active-link swap observed during resolution', () => {
    const fixture = releaseFixture();
    const secondRelease = join(fixture.releasesRoot, '20260901-def');
    mkdirSync(join(secondRelease, 'deploy', 'vps'), { recursive: true });
    writeFileSync(join(secondRelease, '.release-metadata.json'), '{"releaseId":"20260901-def"}\n');
    writeFileSync(
      join(secondRelease, 'deploy', 'vps', 'ecosystem.config.cjs'),
      'module.exports = { apps: [] };\n'
    );

    expect(() =>
      resolveActiveReleaseLink({
        sourceId: 'edutrack.pm2_ecosystem',
        currentPath: fixture.current,
        approvedTargetRoot: fixture.releasesRoot,
        fixedDescendant: 'deploy/vps/ecosystem.config.cjs',
        testHooks: {
          afterLinkRead: () => {
            unlinkSync(fixture.current);
            symlinkSync(secondRelease, fixture.current);
          }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'ACTIVE_RELEASE_CHANGED' }));
  });
});
