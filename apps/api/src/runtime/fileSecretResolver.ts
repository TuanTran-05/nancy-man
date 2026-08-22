import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const maximumSecretBytes = 4_096;
const secretReference = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export class FileSecretResolver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async resolve(reference: string): Promise<string | null> {
    if (!secretReference.test(reference)) return null;
    const credentialPath = resolve(this.root, reference);
    if (!credentialPath.startsWith(`${this.root}${sep}`)) return null;

    try {
      const rootDetails = await lstat(this.root);
      if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) return null;
      const handle = await open(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const details = await handle.stat();
        if (
          !details.isFile() ||
          details.size > maximumSecretBytes ||
          (details.mode & 0o077) !== 0
        ) {
          return null;
        }
        const secret = (await handle.readFile({ encoding: 'utf8' })).trim();
        return secret || null;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }
}
