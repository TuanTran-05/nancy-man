import { randomUUID } from 'node:crypto';
import {
  chownSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  utimesSync,
  unlinkSync,
  writeSync,
  constants as fsConstants
} from 'node:fs';
import { dirname, join, parse } from 'node:path';

import type {
  AgentManifest,
  ManifestSource
} from '../../../../packages/config-contracts/src/index.js';
import { dotenvFileAdapter } from '../adapters/dotenvFile.js';
import { nodeEnvFileAdapter } from '../adapters/nodeEnvFile.js';
import { pm2EcosystemStaticAdapter } from '../adapters/pm2EcosystemStatic.js';
import { systemdEnvironmentFileAdapter } from '../adapters/systemdEnvironmentFile.js';
import { parseSystemdCredentialFile } from '../adapters/systemdCredentialFile.js';
import {
  serializeUpdatedSource,
  type ParsedSource,
  type SourceWriteOperation
} from '../adapters/types.js';
import {
  readSafeSourceFile,
  resolveActiveReleaseLink,
  type SafeSourceMetadata,
  type SourceFileExpectation
} from '../security/safeSourceFile.js';
import { fingerprintSource, type FingerprintKey } from '../inventory/fingerprint.js';

export type AtomicSourceRead = Readonly<{
  sourceId: string;
  path: string;
  bytes: Buffer;
  metadata: SafeSourceMetadata;
}>;

export type AtomicSourceReader = (
  source: ManifestSource
) => AtomicSourceRead | Promise<AtomicSourceRead>;

export type AtomicWriteOperation = SourceWriteOperation;

export type AtomicSourceWriterOptions = Readonly<{
  manifest: Pick<AgentManifest, 'sources'>;
  fingerprintKey: FingerprintKey;
  readSource?: AtomicSourceReader;
  afterRename?: () => void;
}>;

export type AtomicSourceWriteInput = Readonly<{
  sourceId: string;
  expectedSourceFingerprint: string;
  operations: readonly AtomicWriteOperation[];
}>;

export type AtomicSourceRestoreInput = Readonly<{
  sourceId: string;
  bytes: Uint8Array;
  metadata: Pick<SafeSourceMetadata, 'uid' | 'gid' | 'mode'>;
}>;

export type AtomicSourceWriterErrorCode =
  | 'CONFIG_SOURCE_CHANGED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_HARD_LINK_REJECTED'
  | 'SOURCE_SYMLINK_REJECTED'
  | 'SOURCE_METADATA_DRIFT'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_NOT_WRITABLE'
  | 'REQUIRED_DELETE'
  | 'SOURCE_PARSE_FAILED'
  | 'SOURCE_WRITE_FAILED'
  | 'SOURCE_POST_WRITE_VERIFY_FAILED'
  | 'SOURCE_ADAPTER_UNSUPPORTED';

export class AtomicSourceWriterError extends Error {
  readonly code: AtomicSourceWriterErrorCode;

  constructor(code: AtomicSourceWriterErrorCode) {
    super(code);
    this.name = 'AtomicSourceWriterError';
    this.code = code;
  }
}

function fail(code: AtomicSourceWriterErrorCode): never {
  throw new AtomicSourceWriterError(code);
}

function accountId(file: string, name: string, field: 0 | 2): number | undefined {
  try {
    for (const line of requireText(`/etc/${file}`)) {
      const fields = line.split(':');
      if (fields[0] === name && fields[field] && /^[0-9]+$/u.test(fields[field])) {
        return Number(fields[field]);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function requireText(path: string): string[] {
  // Keep the source reader free of shell/process dependencies.
  return readFileSync(path, 'utf8').split(/\r?\n/u);
}

function resolveSource(source: ManifestSource): { path: string; trustedRoot?: string } {
  if (source.locator.kind === 'file') return { path: source.locator.path };
  const resolved = resolveActiveReleaseLink({
    sourceId: source.id,
    currentPath: source.locator.currentPath,
    approvedTargetRoot: source.locator.approvedTargetRoot,
    fixedDescendant: source.locator.fixedDescendant
  });
  return { path: resolved.sourcePath, trustedRoot: resolved.releasePath };
}

function defaultReadSource(source: ManifestSource): AtomicSourceRead {
  const uid = accountId('passwd', source.owner, 2);
  const gid = accountId('group', source.group, 2);
  if (uid === undefined || gid === undefined) fail('SOURCE_NOT_FOUND');
  const resolved = resolveSource(source);
  return readSafeSourceFile({
    sourceId: source.id,
    path: resolved.path,
    ...(resolved.trustedRoot ? { trustedRoot: resolved.trustedRoot } : {}),
    expected: { uid, gid, mode: source.mode, maximumBytes: source.maximumBytes }
  });
}

function adapterFor(source: ManifestSource) {
  switch (source.adapterId) {
    case 'node_env_file':
      return nodeEnvFileAdapter;
    case 'systemd_environment_file':
      return systemdEnvironmentFileAdapter;
    case 'dotenv':
      return dotenvFileAdapter;
    case 'pm2_ecosystem_static':
      return pm2EcosystemStaticAdapter;
    default:
      return null;
  }
}

function parseSource(source: ManifestSource, bytes: Buffer, name: string): ParsedSource {
  try {
    if (source.adapterId === 'systemd_credential_file') {
      return parseSystemdCredentialFile(bytes, {
        name,
        displayEncoding: 'text',
        maximumBytes: source.maximumBytes
      });
    }
    const adapter = adapterFor(source);
    if (!adapter) fail('SOURCE_ADAPTER_UNSUPPORTED');
    return adapter.parse(bytes, { maximumBytes: source.maximumBytes });
  } catch (error) {
    if (error instanceof AtomicSourceWriterError) throw error;
    fail('SOURCE_PARSE_FAILED');
  }
}

function metadataExpectation(
  metadata: SafeSourceMetadata,
  maximumBytes: number
): SourceFileExpectation {
  return { uid: metadata.uid, gid: metadata.gid, mode: metadata.mode, maximumBytes, nlink: 1 };
}

function assertWritableSource(
  source: ManifestSource,
  operations: readonly AtomicWriteOperation[]
): void {
  if (source.mutability !== 'catalog_controlled' || source.adapterId === 'pm2_ecosystem_static') {
    fail('SOURCE_NOT_WRITABLE');
  }
  for (const operation of operations) {
    if (operation.operation === 'delete' && operation.requirement !== 'optional')
      fail('REQUIRED_DELETE');
    if (operation.operation === 'set' && operation.value === undefined) fail('SOURCE_PARSE_FAILED');
  }
}

function assertStableMetadata(left: SafeSourceMetadata, right: SafeSourceMetadata): void {
  if (left.dev !== right.dev || left.ino !== right.ino) fail('SOURCE_METADATA_DRIFT');
  if (right.nlink !== 1) fail('SOURCE_HARD_LINK_REJECTED');
  if (
    left.uid !== right.uid ||
    left.gid !== right.gid ||
    left.mode !== right.mode ||
    left.size !== right.size ||
    left.mtimeMs !== right.mtimeMs
  ) {
    fail('SOURCE_METADATA_DRIFT');
  }
}

function assertTarget(path: string, sourceId: string, maximumBytes: number): SafeSourceMetadata {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    fail('SOURCE_NOT_FOUND');
  }
  if (stat.isSymbolicLink()) fail('SOURCE_SYMLINK_REJECTED');
  if (!stat.isFile()) fail('SOURCE_METADATA_DRIFT');
  if (stat.nlink !== 1) fail('SOURCE_HARD_LINK_REJECTED');
  if (stat.size > maximumBytes) fail('SOURCE_TOO_LARGE');
  void sourceId;
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode & 0o7777,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function writeFileAtomically(
  path: string,
  bytes: Uint8Array,
  metadata: Pick<SafeSourceMetadata, 'uid' | 'gid' | 'mode'>,
  maximumBytes: number,
  afterRename: (() => void) | undefined
): void {
  if (bytes.byteLength > maximumBytes) fail('SOURCE_TOO_LARGE');
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail('SOURCE_METADATA_DRIFT');
  const temporary = join(parent, `.${parse(path).base}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor = -1;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    let offset = 0;
    const buffer = Buffer.from(bytes);
    while (offset < buffer.length) {
      const written = writeSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (written <= 0) fail('SOURCE_WRITE_FAILED');
      offset += written;
    }
    chmodSync(temporary, metadata.mode);
    chownSync(temporary, metadata.uid, metadata.gid);
    const original = lstatSync(path);
    if (original.isSymbolicLink() || !original.isFile() || original.nlink !== 1) {
      fail(original.isSymbolicLink() ? 'SOURCE_SYMLINK_REJECTED' : 'SOURCE_HARD_LINK_REJECTED');
    }
    utimesSync(temporary, original.atime, original.mtime);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = -1;
    renameSync(temporary, path);
    afterRename?.();
    const parentDescriptor = openSync(
      parent,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0)
    );
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
  } catch (error) {
    if (error instanceof AtomicSourceWriterError) throw error;
    fail('SOURCE_WRITE_FAILED');
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort cleanup; the target was never replaced if this path remains.
      }
    }
  }
}

export function createAtomicSourceWriter(options: AtomicSourceWriterOptions) {
  const readSource = options.readSource ?? defaultReadSource;
  const sources = new Map(options.manifest.sources.map((source) => [source.id, source]));

  async function readCurrent(sourceId: string): Promise<AtomicSourceRead> {
    const source = sources.get(sourceId);
    if (!source) fail('SOURCE_NOT_FOUND');
    try {
      const read = await readSource(source);
      if (read.sourceId !== source.id || read.metadata.nlink !== 1)
        fail('SOURCE_HARD_LINK_REJECTED');
      return read;
    } catch (error) {
      if (error instanceof AtomicSourceWriterError) throw error;
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'SOURCE_HARD_LINK_REJECTED') fail('SOURCE_HARD_LINK_REJECTED');
      if (code === 'SOURCE_SYMLINK_REJECTED') fail('SOURCE_SYMLINK_REJECTED');
      if (code === 'SOURCE_TOO_LARGE') fail('SOURCE_TOO_LARGE');
      if (code === 'SOURCE_METADATA_DRIFT') fail('SOURCE_METADATA_DRIFT');
      fail('SOURCE_NOT_FOUND');
    }
  }

  async function write(input: AtomicSourceWriteInput): Promise<{ sourceFingerprint: string }> {
    const source = sources.get(input.sourceId);
    if (!source) fail('SOURCE_NOT_FOUND');
    assertWritableSource(source, input.operations);
    const current = await readCurrent(input.sourceId);
    const currentFingerprint = fingerprintSource(options.fingerprintKey, source.id, current.bytes);
    if (currentFingerprint !== input.expectedSourceFingerprint) fail('CONFIG_SOURCE_CHANGED');
    const beforeTarget = assertTarget(current.path, source.id, source.maximumBytes);
    assertStableMetadata(current.metadata, beforeTarget);
    const name = input.operations[0]?.name;
    if (!name) fail('SOURCE_PARSE_FAILED');
    const parsed = parseSource(source, current.bytes, name);
    if (
      input.operations.some(
        (operation) =>
          parsed.definitions.filter((item) => item.name === operation.name).length !== 1
      )
    ) {
      fail('SOURCE_PARSE_FAILED');
    }
    const nextBytes = serializeUpdatedSource(parsed, input.operations);
    writeFileAtomically(
      current.path,
      nextBytes,
      current.metadata,
      source.maximumBytes,
      options.afterRename
    );
    try {
      const after = await readCurrent(input.sourceId);
      const expected = metadataExpectation(current.metadata, source.maximumBytes);
      if (
        after.metadata.uid !== expected.uid ||
        after.metadata.gid !== expected.gid ||
        after.metadata.mode !== expected.mode ||
        after.metadata.nlink !== 1
      ) {
        fail('SOURCE_POST_WRITE_VERIFY_FAILED');
      }
      const reparsed = parseSource(source, after.bytes, name);
      if (reparsed.definitions.some((definition) => definition.value.includes('\u0000'))) {
        fail('SOURCE_POST_WRITE_VERIFY_FAILED');
      }
      return {
        sourceFingerprint: fingerprintSource(options.fingerprintKey, source.id, after.bytes)
      };
    } catch (error) {
      if (error instanceof AtomicSourceWriterError) throw error;
      fail('SOURCE_POST_WRITE_VERIFY_FAILED');
    }
  }

  async function restore(input: AtomicSourceRestoreInput): Promise<{ sourceFingerprint: string }> {
    const source = sources.get(input.sourceId);
    if (!source) fail('SOURCE_NOT_FOUND');
    if (source.mutability !== 'catalog_controlled') fail('SOURCE_NOT_WRITABLE');
    const current = await readCurrent(input.sourceId);
    assertTarget(current.path, source.id, source.maximumBytes);
    writeFileAtomically(
      current.path,
      input.bytes,
      input.metadata,
      source.maximumBytes,
      options.afterRename
    );
    const after = await readCurrent(input.sourceId);
    if (
      after.metadata.uid !== input.metadata.uid ||
      after.metadata.gid !== input.metadata.gid ||
      after.metadata.mode !== input.metadata.mode
    ) {
      fail('SOURCE_POST_WRITE_VERIFY_FAILED');
    }
    return { sourceFingerprint: fingerprintSource(options.fingerprintKey, source.id, after.bytes) };
  }

  return { readCurrent, write, restore };
}
