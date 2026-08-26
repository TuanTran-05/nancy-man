import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function validObjectKey(key: string): boolean {
  return (
    /^source-maps\/[A-Za-z0-9][A-Za-z0-9._/-]{0,1024}\.map$/.test(key) &&
    !key.split('/').includes('..')
  );
}

export class FileObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private objectPath(key: string): string {
    if (!validObjectKey(key)) throw new Error('Object key is invalid');
    const objectPath = resolve(this.root, key);
    if (!objectPath.startsWith(`${this.root}${sep}`))
      throw new Error('Object key escapes object storage');
    return objectPath;
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error('Object storage directory must not be a symbolic link');
    }
  }

  private async existingOutcome(
    objectPath: string,
    expectedChecksum: string
  ): Promise<'identical' | 'conflict'> {
    const details = await lstat(objectPath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('Existing object is not a regular file');
    }
    const content = await readFile(objectPath, 'utf8');
    return checksum(content) === expectedChecksum ? 'identical' : 'conflict';
  }

  private async removeTemporary(temporaryPath: string): Promise<void> {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }

  async putIfAbsent(
    key: string,
    content: string,
    expectedChecksum: string
  ): Promise<'created' | 'identical' | 'conflict'> {
    if (!/^[a-f0-9]{64}$/i.test(expectedChecksum) || checksum(content) !== expectedChecksum) {
      throw new Error('Object checksum mismatch');
    }
    const objectPath = this.objectPath(key);
    await this.ensureDirectory(this.root);
    await this.ensureDirectory(dirname(objectPath));

    const temporaryPath = `${objectPath}.tmp-${process.pid}-${randomUUID()}`;
    let result: 'created' | 'identical' | 'conflict';
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, objectPath);
        result = 'created';
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        result = await this.existingOutcome(objectPath, expectedChecksum);
      }
    } catch (error) {
      await this.removeTemporary(temporaryPath);
      throw error;
    }
    await this.removeTemporary(temporaryPath);
    return result;
  }

  async get(key: string): Promise<string | null> {
    const objectPath = this.objectPath(key);
    try {
      const details = await lstat(objectPath);
      if (!details.isFile() || details.isSymbolicLink())
        throw new Error('Stored object is not a regular file');
      return await readFile(objectPath, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }
}
