import { linkSync, lstatSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import type {
  AgentManifest,
  ManifestSource
} from '../../../../packages/config-contracts/src/index.js';
import { createFingerprintKey, fingerprintSource } from '../inventory/fingerprint.js';
import {
  createAtomicSourceWriter,
  AtomicSourceWriterError,
  type AtomicSourceReader
} from './atomicSourceWriter.js';

const key = createFingerprintKey('atomic-writer-fingerprint', 'v1');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edutrack-atomic-writer-'));
  const path = join(root, 'source.env');
  const source: ManifestSource = {
    id: 'edutrack.shared_env',
    appId: 'edutrack',
    pathLabel: 'fixture source',
    adapterId: 'node_env_file',
    mutability: 'catalog_controlled',
    locator: { kind: 'file', path },
    owner: 'deploy',
    group: 'deploy',
    mode: '0640',
    maximumBytes: 1_048_576,
    precedenceRank: 10
  };
  const manifest: AgentManifest = {
    manifestVersion: '2026-08-31',
    catalogVersion: '2026-08-31',
    catalogDigest: `sha256:${'a'.repeat(64)}`,
    readOnly: true,
    apps: [{ id: 'edutrack', displayName: 'EduTrack', sourceIds: [source.id] }],
    sources: [source],
    actions: [],
    checks: []
  };
  const readSource: AtomicSourceReader = (candidate) => {
    const bytes = readFileSync(candidate.locator.kind === 'file' ? candidate.locator.path : path);
    const stat = statSync(path);
    return {
      sourceId: candidate.id,
      path,
      bytes,
      metadata: {
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid,
        gid: stat.gid,
        mode: stat.mode & 0o7777,
        nlink: stat.nlink,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      }
    };
  };
  return { root, path, source, manifest, readSource };
}

describe('descriptor-safe atomic source writer', () => {
  test('changes one definition while preserving unrelated bytes, metadata, and line endings', async () => {
    const item = fixture();
    const original = Buffer.from('# keep\r\nPORT="3000"\r\nOTHER=untouched\r\n');
    writeFileSync(item.path, original, { mode: 0o640 });
    const before = statSync(item.path);
    const writer = createAtomicSourceWriter({
      manifest: item.manifest,
      fingerprintKey: key,
      readSource: item.readSource
    });

    const result = await writer.write({
      sourceId: item.source.id,
      expectedSourceFingerprint: fingerprintSource(key, item.source.id, original),
      operations: [
        {
          name: 'PORT',
          duplicateOrdinal: 0,
          operation: 'set',
          requirement: 'required',
          value: '3001'
        }
      ]
    });

    expect(result.sourceFingerprint).toBe(
      fingerprintSource(key, item.source.id, readFileSync(item.path))
    );
    expect(readFileSync(item.path)).toEqual(
      Buffer.from('# keep\r\nPORT="3001"\r\nOTHER=untouched\r\n')
    );
    const after = statSync(item.path);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o7777).toBe(before.mode & 0o7777);
    expect(lstatSync(item.path).nlink).toBe(1);
  });

  test('rejects stale fingerprints before creating or renaming a file', async () => {
    const item = fixture();
    const original = Buffer.from('PORT=3000\n');
    writeFileSync(item.path, original, { mode: 0o640 });
    const writer = createAtomicSourceWriter({
      manifest: item.manifest,
      fingerprintKey: key,
      readSource: item.readSource
    });

    await expect(
      writer.write({
        sourceId: item.source.id,
        expectedSourceFingerprint: fingerprintSource(
          key,
          item.source.id,
          Buffer.from('PORT=2999\n')
        ),
        operations: [
          {
            name: 'PORT',
            duplicateOrdinal: 0,
            operation: 'set',
            requirement: 'required',
            value: '3001'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'CONFIG_SOURCE_CHANGED' });
    expect(readFileSync(item.path)).toEqual(original);
  });

  test('deletes only an optional definition and rejects required delete and hard-link sources', async () => {
    const item = fixture();
    const original = Buffer.from('PORT=3000\nOPTIONAL=old\n');
    writeFileSync(item.path, original, { mode: 0o640 });
    const writer = createAtomicSourceWriter({
      manifest: item.manifest,
      fingerprintKey: key,
      readSource: item.readSource
    });

    await expect(
      writer.write({
        sourceId: item.source.id,
        expectedSourceFingerprint: fingerprintSource(key, item.source.id, original),
        operations: [
          { name: 'PORT', duplicateOrdinal: 0, operation: 'delete', requirement: 'required' }
        ]
      })
    ).rejects.toMatchObject({ code: 'REQUIRED_DELETE' });

    await writer.write({
      sourceId: item.source.id,
      expectedSourceFingerprint: fingerprintSource(key, item.source.id, original),
      operations: [
        { name: 'OPTIONAL', duplicateOrdinal: 0, operation: 'delete', requirement: 'optional' }
      ]
    });
    expect(readFileSync(item.path).toString('utf8')).toBe('PORT=3000\n');

    linkSync(item.path, join(item.root, 'hard-link.env'));
    await expect(
      writer.write({
        sourceId: item.source.id,
        expectedSourceFingerprint: fingerprintSource(key, item.source.id, readFileSync(item.path)),
        operations: [
          {
            name: 'PORT',
            duplicateOrdinal: 0,
            operation: 'set',
            requirement: 'required',
            value: '3001'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'SOURCE_HARD_LINK_REJECTED' });
  });

  test('fails closed when the source adapter is observation-only', async () => {
    const item = fixture();
    const observed = {
      ...item.source,
      adapterId: 'pm2_ecosystem_static' as const,
      mutability: 'observed' as const
    };
    const writer = createAtomicSourceWriter({
      manifest: { ...item.manifest, sources: [observed] },
      fingerprintKey: key,
      readSource: item.readSource
    });
    writeFileSync(item.path, 'module.exports = { apps: [] };', { mode: 0o640 });
    await expect(
      writer.write({
        sourceId: observed.id,
        expectedSourceFingerprint: fingerprintSource(key, observed.id, readFileSync(item.path)),
        operations: [
          {
            name: 'PORT',
            duplicateOrdinal: 0,
            operation: 'set',
            requirement: 'required',
            value: '3001'
          }
        ]
      })
    ).rejects.toBeInstanceOf(AtomicSourceWriterError);
  });
});
