import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
  constants as fsConstants
} from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import type { Stats } from 'node:fs';

export type SafeSourceErrorCode =
  | 'SOURCE_PATH_TRAVERSAL'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_DIRECTORY'
  | 'SOURCE_SYMLINK_REJECTED'
  | 'SOURCE_NOT_REGULAR'
  | 'SOURCE_HARD_LINK_REJECTED'
  | 'SOURCE_METADATA_DRIFT'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_OPEN_FAILED'
  | 'SOURCE_READ_FAILED'
  | 'ACTIVE_RELEASE_CHANGED'
  | 'ACTIVE_RELEASE_INVALID'
  | 'ACTIVE_RELEASE_METADATA_MISSING'
  | 'ACTIVE_RELEASE_METADATA_INVALID';

export class SafeSourceError extends Error {
  readonly code: SafeSourceErrorCode;
  readonly sourceId: string;

  constructor(code: SafeSourceErrorCode, sourceId = 'unknown') {
    super(`${code} (${sourceId})`);
    this.name = 'SafeSourceError';
    this.code = code;
    this.sourceId = sourceId;
  }
}

export type SourceFileExpectation = Readonly<{
  uid?: number;
  gid?: number;
  ownerUid?: number;
  groupGid?: number;
  mode: number | string;
  maximumBytes: number;
  nlink?: number;
}>;

export type SafeSourceReadOptions = Readonly<{
  sourceId: string;
  path: string;
  expected: SourceFileExpectation;
  trustedRoot?: string;
  testHooks?: Readonly<{ afterOpen?: () => void }>;
}>;

export type SafeSourceMetadata = Readonly<{
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
}>;

export type SafeSourceReadResult = Readonly<{
  sourceId: string;
  path: string;
  bytes: Buffer;
  metadata: SafeSourceMetadata;
}>;

function fail(code: SafeSourceErrorCode, sourceId: string): never {
  throw new SafeSourceError(code, sourceId);
}

function mapFsError(error: unknown, sourceId: string, fallback: SafeSourceErrorCode): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') fail('SOURCE_NOT_FOUND', sourceId);
  if (code === 'ELOOP') fail('SOURCE_SYMLINK_REJECTED', sourceId);
  fail(fallback, sourceId);
}

function canonicalAbsolutePath(value: string, sourceId: string): string {
  if (!isAbsolute(value) || normalize(value) !== value || value.includes('\u0000')) {
    fail('SOURCE_PATH_TRAVERSAL', sourceId);
  }
  if (value.split(sep).some((part) => part === '..')) fail('SOURCE_PATH_TRAVERSAL', sourceId);
  return value;
}

function assertWithinRoot(filePath: string, root: string, sourceId: string): void {
  const canonicalRoot = canonicalAbsolutePath(root, sourceId);
  if (filePath !== canonicalRoot && !filePath.startsWith(`${canonicalRoot}${sep}`)) {
    fail('SOURCE_PATH_TRAVERSAL', sourceId);
  }
}

function statIsIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function modeValue(mode: number | string, sourceId: string): number {
  if (typeof mode === 'number') {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)
      fail('SOURCE_METADATA_DRIFT', sourceId);
    return mode;
  }
  if (!/^[0-7]{4}$/u.test(mode)) fail('SOURCE_METADATA_DRIFT', sourceId);
  return Number.parseInt(mode, 8);
}

function assertExpectation(stat: Stats, expected: SourceFileExpectation, sourceId: string): void {
  if (!stat.isFile()) fail('SOURCE_NOT_REGULAR', sourceId);
  const expectedUid = expected.uid ?? expected.ownerUid;
  const expectedGid = expected.gid ?? expected.groupGid;
  if (expectedUid !== undefined && stat.uid !== expectedUid)
    fail('SOURCE_METADATA_DRIFT', sourceId);
  if (expectedGid !== undefined && stat.gid !== expectedGid)
    fail('SOURCE_METADATA_DRIFT', sourceId);
  if ((stat.mode & 0o7777) !== modeValue(expected.mode, sourceId)) {
    fail('SOURCE_METADATA_DRIFT', sourceId);
  }
  const expectedNlink = expected.nlink ?? 1;
  if (stat.nlink !== expectedNlink || stat.nlink !== 1) fail('SOURCE_HARD_LINK_REJECTED', sourceId);
  if (!Number.isSafeInteger(expected.maximumBytes) || expected.maximumBytes <= 0) {
    fail('SOURCE_TOO_LARGE', sourceId);
  }
  if (stat.size > expected.maximumBytes) fail('SOURCE_TOO_LARGE', sourceId);
}

function walkNoSymlink(filePath: string, sourceId: string): Stats {
  const parts = filePath.split(sep).filter(Boolean);
  let current: string = sep;
  for (const [index, part] of parts.entries()) {
    current = current === sep ? `${sep}${part}` : `${current}${sep}${part}`;
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      return mapFsError(error, sourceId, 'SOURCE_NOT_FOUND');
    }
    if (stat.isSymbolicLink()) fail('SOURCE_SYMLINK_REJECTED', sourceId);
    if (index < parts.length - 1 && !stat.isDirectory()) fail('SOURCE_NOT_DIRECTORY', sourceId);
  }
  try {
    return lstatSync(filePath);
  } catch (error) {
    return mapFsError(error, sourceId, 'SOURCE_NOT_FOUND');
  }
}

function openDescriptorRelative(
  filePath: string,
  sourceId: string,
  trustedRoot: string | undefined
): number {
  const root = trustedRoot ?? sep;
  const rootPrefix = root === sep ? sep : `${root}${sep}`;
  const relative = filePath === root ? '' : filePath.slice(rootPrefix.length);
  const parts = relative.split(sep).filter(Boolean);
  if (parts.length === 0) fail('SOURCE_NOT_REGULAR', sourceId);
  const directoryFlags =
    fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);
  let directoryDescriptor: number;
  try {
    directoryDescriptor = openSync(root, directoryFlags);
  } catch (error) {
    return mapFsError(error, sourceId, 'SOURCE_OPEN_FAILED');
  }
  try {
    for (const [index, part] of parts.entries()) {
      const final = index === parts.length - 1;
      const flags = final ? fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) : directoryFlags;
      let childDescriptor: number;
      try {
        childDescriptor = openSync(`/proc/self/fd/${directoryDescriptor}/${part}`, flags);
      } catch (error) {
        return mapFsError(error, sourceId, 'SOURCE_OPEN_FAILED');
      }
      closeSync(directoryDescriptor);
      if (final) return childDescriptor;
      directoryDescriptor = childDescriptor;
    }
  } catch (error) {
    try {
      closeSync(directoryDescriptor);
    } catch {
      // Preserve the stable source error from the failed operation.
    }
    return mapFsError(error, sourceId, 'SOURCE_OPEN_FAILED');
  }
  try {
    closeSync(directoryDescriptor);
  } catch {
    // The descriptor is best-effort cleanup after an impossible empty path.
  }
  fail('SOURCE_OPEN_FAILED', sourceId);
}

function metadata(stat: Stats): SafeSourceMetadata {
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

export function readSafeSourceFile(options: SafeSourceReadOptions): SafeSourceReadResult {
  const sourceId = options.sourceId;
  const filePath = canonicalAbsolutePath(options.path, sourceId);
  if (options.trustedRoot) assertWithinRoot(filePath, options.trustedRoot, sourceId);
  const beforeOpen = walkNoSymlink(filePath, sourceId);
  assertExpectation(beforeOpen, options.expected, sourceId);

  const descriptor = openDescriptorRelative(filePath, sourceId, options.trustedRoot);

  try {
    options.testHooks?.afterOpen?.();
    let opened: Stats;
    try {
      opened = fstatSync(descriptor);
    } catch (error) {
      return mapFsError(error, sourceId, 'SOURCE_READ_FAILED');
    }
    if (!statIsIdentity(beforeOpen, opened)) {
      fail('SOURCE_METADATA_DRIFT', sourceId);
    }
    if (opened.size > options.expected.maximumBytes) fail('SOURCE_TOO_LARGE', sourceId);
    if (
      opened.size !== beforeOpen.size ||
      opened.mtimeMs !== beforeOpen.mtimeMs ||
      opened.nlink !== beforeOpen.nlink ||
      opened.uid !== beforeOpen.uid ||
      opened.gid !== beforeOpen.gid ||
      (opened.mode & 0o7777) !== (beforeOpen.mode & 0o7777)
    ) {
      fail('SOURCE_METADATA_DRIFT', sourceId);
    }
    assertExpectation(opened, options.expected, sourceId);

    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      let count: number;
      try {
        count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      } catch (error) {
        return mapFsError(error, sourceId, 'SOURCE_READ_FAILED');
      }
      if (count <= 0) fail('SOURCE_READ_FAILED', sourceId);
      offset += count;
      if (offset > options.expected.maximumBytes) fail('SOURCE_TOO_LARGE', sourceId);
    }

    const afterRead = fstatSync(descriptor);
    if (!statIsIdentity(opened, afterRead)) {
      fail('SOURCE_METADATA_DRIFT', sourceId);
    }
    if (afterRead.size > options.expected.maximumBytes) fail('SOURCE_TOO_LARGE', sourceId);
    if (
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.nlink !== opened.nlink
    ) {
      fail('SOURCE_METADATA_DRIFT', sourceId);
    }
    const afterPath = walkNoSymlink(filePath, sourceId);
    if (!statIsIdentity(opened, afterPath)) fail('SOURCE_METADATA_DRIFT', sourceId);
    assertExpectation(afterPath, options.expected, sourceId);
    return { sourceId, path: filePath, bytes, metadata: metadata(afterPath) };
  } finally {
    closeSync(descriptor);
  }
}

export type ActiveReleaseLinkOptions = Readonly<{
  sourceId: string;
  currentPath: string;
  approvedTargetRoot: string;
  fixedDescendant: string;
  releaseMetadataFile?: string;
  metadataFileName?: string;
  testHooks?: Readonly<{ afterLinkRead?: () => void }>;
}>;

export type ActiveReleaseResolution = Readonly<{
  sourceId: string;
  releaseId: string;
  releasePath: string;
  metadataPath: string;
  sourcePath: string;
}>;

function directChildTarget(linkTarget: string, releasesRoot: string, sourceId: string): string {
  if (!isAbsolute(linkTarget) || normalize(linkTarget) !== linkTarget) {
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  }
  const targetRoot = resolve(linkTarget, '..');
  if (targetRoot !== releasesRoot) fail('ACTIVE_RELEASE_INVALID', sourceId);
  const releaseId = linkTarget.slice(`${releasesRoot}${sep}`.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(releaseId) || releaseId.includes(sep)) {
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  }
  return linkTarget;
}

function safeChildPath(root: string, descendant: string, sourceId: string): string {
  if (
    !descendant ||
    isAbsolute(descendant) ||
    normalize(descendant) !== descendant ||
    descendant.includes('\u0000') ||
    descendant.split(/[\\/]/u).some((part) => !part || part === '..')
  ) {
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  }
  return `${root}${sep}${descendant.split(/[\\/]/u).join(sep)}`;
}

function verifyReleaseDescendant(
  releasePath: string,
  descendant: string,
  sourceId: string
): string {
  const path = safeChildPath(releasePath, descendant, sourceId);
  walkNoSymlink(path, sourceId);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1) {
    if (stat.nlink !== 1) fail('SOURCE_HARD_LINK_REJECTED', sourceId);
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  }
  return path;
}

function readReleaseMetadata(path: string, releaseId: string, sourceId: string): void {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      fail('ACTIVE_RELEASE_METADATA_MISSING', sourceId);
    return mapFsError(error, sourceId, 'ACTIVE_RELEASE_METADATA_INVALID');
  }
  if (stat.isSymbolicLink()) fail('SOURCE_SYMLINK_REJECTED', sourceId);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0 || stat.size > 16_384) {
    fail('ACTIVE_RELEASE_METADATA_INVALID', sourceId);
  }
  let metadataText: string;
  try {
    const result = readSafeSourceFile({
      sourceId,
      path,
      expected: {
        uid: stat.uid,
        gid: stat.gid,
        mode: stat.mode & 0o7777,
        maximumBytes: 16_384
      }
    });
    metadataText = result.bytes.toString('utf8');
  } catch (error) {
    if (error instanceof SafeSourceError && error.code === 'SOURCE_NOT_FOUND') {
      fail('ACTIVE_RELEASE_METADATA_MISSING', sourceId);
    }
    fail('ACTIVE_RELEASE_METADATA_INVALID', sourceId);
  }
  try {
    const parsed: unknown = JSON.parse(metadataText);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).releaseId !== 'string' ||
      (parsed as Record<string, unknown>).releaseId !== releaseId
    ) {
      fail('ACTIVE_RELEASE_METADATA_INVALID', sourceId);
    }
  } catch (error) {
    if (error instanceof SafeSourceError) throw error;
    fail('ACTIVE_RELEASE_METADATA_INVALID', sourceId);
  }
}

export function resolveActiveReleaseLink(
  options: ActiveReleaseLinkOptions
): ActiveReleaseResolution {
  const sourceId = options.sourceId;
  const currentPath = canonicalAbsolutePath(options.currentPath, sourceId);
  const releasesRoot = canonicalAbsolutePath(options.approvedTargetRoot, sourceId);
  const rootStat = walkNoSymlink(releasesRoot, sourceId);
  if (!rootStat.isDirectory()) fail('ACTIVE_RELEASE_INVALID', sourceId);
  let currentStat: Stats;
  try {
    currentStat = lstatSync(currentPath);
  } catch (error) {
    return mapFsError(error, sourceId, 'ACTIVE_RELEASE_CHANGED');
  }
  if (!currentStat.isSymbolicLink()) fail('ACTIVE_RELEASE_INVALID', sourceId);
  let linkTarget: string;
  try {
    linkTarget = readlinkSync(currentPath);
  } catch (error) {
    return mapFsError(error, sourceId, 'ACTIVE_RELEASE_CHANGED');
  }
  options.testHooks?.afterLinkRead?.();
  const releasePath = directChildTarget(linkTarget, releasesRoot, sourceId);
  let releaseStat = lstatSync(releasePath);
  if (!releaseStat.isDirectory() || releaseStat.isSymbolicLink())
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  const releaseId = releasePath.slice(`${releasesRoot}${sep}`.length);
  const metadataName =
    options.releaseMetadataFile ?? options.metadataFileName ?? '.release-metadata.json';
  if (!/^[A-Za-z0-9._-]+$/u.test(metadataName) || metadataName === '.' || metadataName === '..') {
    fail('ACTIVE_RELEASE_INVALID', sourceId);
  }
  const metadataPath = `${releasePath}${sep}${metadataName}`;
  readReleaseMetadata(metadataPath, releaseId, sourceId);
  const sourcePath = verifyReleaseDescendant(releasePath, options.fixedDescendant, sourceId);

  const currentAfter = lstatSync(currentPath);
  let linkTargetAfter: string;
  try {
    linkTargetAfter = readlinkSync(currentPath);
  } catch {
    fail('ACTIVE_RELEASE_CHANGED', sourceId);
  }
  releaseStat = lstatSync(releasePath);
  if (
    !statIsIdentity(currentStat, currentAfter) ||
    linkTargetAfter !== linkTarget ||
    !releaseStat.isDirectory()
  ) {
    fail('ACTIVE_RELEASE_CHANGED', sourceId);
  }
  return { sourceId, releaseId, releasePath, metadataPath, sourcePath };
}
