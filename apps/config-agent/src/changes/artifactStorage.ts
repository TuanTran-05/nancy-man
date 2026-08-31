import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, normalize, parse, join } from 'node:path';

const DIRECTORY_MODE = 0o700;
const ARTIFACT_MODE = 0o600;
const INDEX_NAME = 'index.json';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type ArtifactKind = 'draft' | 'staged' | 'snapshot';
export type ArtifactRetention = 'normal' | 'rollback_failed';

export type ArtifactIndexEntry = Readonly<{
  id: string;
  kind: ArtifactKind;
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  createdAt: string;
  expiresAt: string;
  retention: ArtifactRetention;
}>;

export type SecureStorageOptions = Readonly<{
  stateDirectory: string;
  ownerUid?: number;
  groupGid?: number;
}>;

export class ArtifactStorageError extends Error {
  readonly code:
    | 'ARTIFACT_PATH_INVALID'
    | 'ARTIFACT_DIRECTORY_INVALID'
    | 'ARTIFACT_METADATA_INVALID'
    | 'ARTIFACT_SYMLINK_REJECTED'
    | 'ARTIFACT_NOT_FOUND'
    | 'ARTIFACT_CORRUPT_INDEX'
    | 'ARTIFACT_WRITE_FAILED';

  constructor(
    code: ArtifactStorageError['code']
  ) {
    super(code);
    this.name = 'ArtifactStorageError';
    this.code = code;
  }
}

export const ARTIFACT_DIRECTORIES = ['drafts', 'staged', 'snapshots', 'locks'] as const;
export type ArtifactDirectory = (typeof ARTIFACT_DIRECTORIES)[number];

function fail(code: ArtifactStorageError['code']): never {
  throw new ArtifactStorageError(code);
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function currentGid(): number | undefined {
  return typeof process.getgid === 'function' ? process.getgid() : undefined;
}

function expectedOwner(options: SecureStorageOptions): { uid?: number; gid?: number } {
  const owner: { uid?: number; gid?: number } = {};
  const uid = options.ownerUid ?? currentUid();
  const gid = options.groupGid ?? currentGid();
  if (uid !== undefined) owner.uid = uid;
  if (gid !== undefined) owner.gid = gid;
  return owner;
}

function assertAbsolutePath(path: string): void {
  if (!isAbsolute(path) || path === '/' || path.includes('\u0000') || normalize(path) !== path) {
    fail('ARTIFACT_PATH_INVALID');
  }
}

export function assertArtifactId(id: string): void {
  if (!ID_PATTERN.test(id)) fail('ARTIFACT_PATH_INVALID');
}

function assertMetadata(
  details: Awaited<ReturnType<typeof lstat>>,
  mode: number,
  owner: { uid?: number; gid?: number }
): void {
  if (details.isSymbolicLink()) fail('ARTIFACT_SYMLINK_REJECTED');
  if (!details.isDirectory() || (Number(details.mode) & 0o7777) !== mode) {
    fail('ARTIFACT_DIRECTORY_INVALID');
  }
  if (owner.uid !== undefined && details.uid !== owner.uid) fail('ARTIFACT_METADATA_INVALID');
  if (owner.gid !== undefined && details.gid !== owner.gid) fail('ARTIFACT_METADATA_INVALID');
}

async function ensureDirectory(
  path: string,
  mode: number,
  owner: { uid?: number; gid?: number }
): Promise<void> {
  assertAbsolutePath(path);
  try {
    await mkdir(path, { recursive: true, mode });
  } catch {
    fail('ARTIFACT_DIRECTORY_INVALID');
  }
  try {
    const details = await lstat(path);
    assertMetadata(details, mode, owner);
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    fail('ARTIFACT_DIRECTORY_INVALID');
  }
}

export function directoryPath(options: SecureStorageOptions, directory: ArtifactDirectory): string {
  assertAbsolutePath(options.stateDirectory);
  return join(options.stateDirectory, directory);
}

export async function ensureStorageDirectories(options: SecureStorageOptions): Promise<void> {
  const owner = expectedOwner(options);
  await ensureDirectory(options.stateDirectory, DIRECTORY_MODE, owner);
  await Promise.all(
    ARTIFACT_DIRECTORIES.map((directory) =>
      ensureDirectory(directoryPath(options, directory), DIRECTORY_MODE, owner)
    )
  );
}

export function artifactFilePath(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  id: string
): string {
  assertArtifactId(id);
  return join(directoryPath(options, directory), `${id}.enc`);
}

function indexPath(options: SecureStorageOptions, directory: Exclude<ArtifactDirectory, 'locks'>): string {
  return join(directoryPath(options, directory), INDEX_NAME);
}

function validateDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('ARTIFACT_CORRUPT_INDEX');
  }
}

function validateIndexEntry(value: unknown): ArtifactIndexEntry {
  if (typeof value !== 'object' || value === null) fail('ARTIFACT_CORRUPT_INDEX');
  const entry = value as Record<string, unknown>;
  if (
    (entry.kind !== 'draft' && entry.kind !== 'staged' && entry.kind !== 'snapshot') ||
    (entry.retention !== 'normal' && entry.retention !== 'rollback_failed') ||
    typeof entry.id !== 'string' ||
    typeof entry.changeId !== 'string' ||
    typeof entry.appId !== 'string' ||
    typeof entry.catalogVersion !== 'string' ||
    typeof entry.manifestVersion !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    typeof entry.expiresAt !== 'string'
  ) {
    fail('ARTIFACT_CORRUPT_INDEX');
  }
  for (const id of [entry.id, entry.changeId, entry.appId, entry.catalogVersion, entry.manifestVersion]) {
    if (!ID_PATTERN.test(id as string)) fail('ARTIFACT_CORRUPT_INDEX');
  }
  validateDate(entry.createdAt as string);
  validateDate(entry.expiresAt as string);
  return {
    id: entry.id as string,
    kind: entry.kind,
    changeId: entry.changeId as string,
    appId: entry.appId as string,
    catalogVersion: entry.catalogVersion as string,
    manifestVersion: entry.manifestVersion as string,
    createdAt: entry.createdAt as string,
    expiresAt: entry.expiresAt as string,
    retention: entry.retention
  } as ArtifactIndexEntry;
}

async function assertArtifactFile(path: string, owner: { uid?: number; gid?: number }): Promise<void> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('ARTIFACT_NOT_FOUND');
    fail('ARTIFACT_METADATA_INVALID');
  }
  if (details.isSymbolicLink()) fail('ARTIFACT_SYMLINK_REJECTED');
  if (!details.isFile() || details.nlink !== 1 || (Number(details.mode) & 0o7777) !== ARTIFACT_MODE) {
    fail('ARTIFACT_METADATA_INVALID');
  }
  if (owner.uid !== undefined && details.uid !== owner.uid) fail('ARTIFACT_METADATA_INVALID');
  if (owner.gid !== undefined && details.gid !== owner.gid) fail('ARTIFACT_METADATA_INVALID');
}

export async function readSecureArtifact(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  id: string
): Promise<Buffer> {
  await ensureStorageDirectories(options);
  const owner = expectedOwner(options);
  const path = artifactFilePath(options, directory, id);
  await assertArtifactFile(path, owner);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (Number(before.mode) & 0o7777) !== ARTIFACT_MODE) {
      fail('ARTIFACT_METADATA_INVALID');
    }
    if (owner.uid !== undefined && before.uid !== owner.uid) fail('ARTIFACT_METADATA_INVALID');
    if (owner.gid !== undefined && before.gid !== owner.gid) fail('ARTIFACT_METADATA_INVALID');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.nlink !== 1 ||
      Number(after.mode) !== Number(before.mode) ||
      after.uid !== before.uid ||
      after.gid !== before.gid
    ) {
      fail('ARTIFACT_METADATA_INVALID');
    }
    return bytes;
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') return fail('ARTIFACT_SYMLINK_REJECTED');
    return fail('ARTIFACT_METADATA_INVALID');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeAtomicSecureArtifact(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  id: string,
  bytes: Uint8Array
): Promise<void> {
  await ensureStorageDirectories(options);
  const owner = expectedOwner(options);
  const target = artifactFilePath(options, directory, id);
  const parent = directoryPath(options, directory);
  try {
    await assertArtifactFile(target, owner);
  } catch (error) {
    if (!(error instanceof ArtifactStorageError) || error.code !== 'ARTIFACT_NOT_FOUND') throw error;
  }

  const temporary = join(parent, `.${parse(target).base}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      ARTIFACT_MODE
    );
    await handle.chmod(ARTIFACT_MODE);
    await handle.writeFile(Buffer.from(bytes));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await fsyncDirectory(parent);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    fail('ARTIFACT_WRITE_FAILED');
  }
}

export async function deleteSecureArtifact(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  id: string
): Promise<boolean> {
  await ensureStorageDirectories(options);
  const owner = expectedOwner(options);
  const path = artifactFilePath(options, directory, id);
  try {
    await assertArtifactFile(path, owner);
  } catch (error) {
    if (error instanceof ArtifactStorageError && error.code === 'ARTIFACT_NOT_FOUND') return false;
    throw error;
  }
  await unlink(path);
  await fsyncDirectory(directoryPath(options, directory));
  return true;
}

export async function readArtifactIndex(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>
): Promise<ArtifactIndexEntry[]> {
  await ensureStorageDirectories(options);
  const owner = expectedOwner(options);
  const path = indexPath(options, directory);
  try {
    await assertArtifactFile(path, owner);
  } catch (error) {
    if (error instanceof ArtifactStorageError && error.code === 'ARTIFACT_NOT_FOUND') return [];
    throw error;
  }
  const bytes = await readSecureIndexBytes(path, owner);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    fail('ARTIFACT_CORRUPT_INDEX');
  }
  if (!Array.isArray(parsed)) fail('ARTIFACT_CORRUPT_INDEX');
  return parsed.map(validateIndexEntry);
}

async function readSecureIndexBytes(path: string, owner: { uid?: number; gid?: number }): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (Number(before.mode) & 0o7777) !== ARTIFACT_MODE) {
      fail('ARTIFACT_METADATA_INVALID');
    }
    if (owner.uid !== undefined && before.uid !== owner.uid) fail('ARTIFACT_METADATA_INVALID');
    if (owner.gid !== undefined && before.gid !== owner.gid) fail('ARTIFACT_METADATA_INVALID');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      Number(before.mode) !== Number(after.mode) ||
      before.uid !== after.uid ||
      before.gid !== after.gid
    ) {
      fail('ARTIFACT_METADATA_INVALID');
    }
    return bytes;
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') return fail('ARTIFACT_SYMLINK_REJECTED');
    return fail('ARTIFACT_METADATA_INVALID');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeArtifactIndex(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  entries: readonly ArtifactIndexEntry[]
): Promise<void> {
  const serialized = JSON.stringify(entries.map((entry) => validateIndexEntry(entry))) + '\n';
  await writeAtomicIndex(options, directory, Buffer.from(serialized, 'utf8'));
}

async function writeAtomicIndex(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  bytes: Uint8Array
): Promise<void> {
  await ensureStorageDirectories(options);
  const owner = expectedOwner(options);
  const parent = directoryPath(options, directory);
  const path = indexPath(options, directory);
  try {
    await assertArtifactFile(path, owner);
  } catch (error) {
    if (!(error instanceof ArtifactStorageError) || error.code !== 'ARTIFACT_NOT_FOUND') throw error;
  }
  const temporary = join(parent, `.${INDEX_NAME}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      ARTIFACT_MODE
    );
    await handle.chmod(ARTIFACT_MODE);
    await handle.writeFile(Buffer.from(bytes));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await fsyncDirectory(parent);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    fail('ARTIFACT_WRITE_FAILED');
  }
}

export async function updateArtifactIndex(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>,
  update: (entries: ArtifactIndexEntry[]) => ArtifactIndexEntry[]
): Promise<ArtifactIndexEntry[]> {
  const entries = await readArtifactIndex(options, directory);
  const next = update(entries);
  await writeArtifactIndex(options, directory, next);
  return next;
}

export async function listArtifactIds(
  options: SecureStorageOptions,
  directory: Exclude<ArtifactDirectory, 'locks'>
): Promise<string[]> {
  await ensureStorageDirectories(options);
  const entries = await readdir(directoryPath(options, directory), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.enc'))
    .map((entry) => entry.name.slice(0, -4))
    .filter((id) => ID_PATTERN.test(id));
}

export const SECURE_STORAGE_MODES = Object.freeze({ directory: DIRECTORY_MODE, artifact: ARTIFACT_MODE });
