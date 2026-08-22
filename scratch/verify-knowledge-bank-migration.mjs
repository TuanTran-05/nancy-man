import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const [manifestArg, storageRootArg] = process.argv.slice(2);
if (!manifestArg || !storageRootArg) {
  throw new Error('Usage: node verify-knowledge-bank-migration.mjs <manifest> <storage-root>');
}

const manifest = JSON.parse(await readFile(path.resolve(manifestArg), 'utf8'));
const storageRoot = path.resolve(storageRootArg);
if (!Array.isArray(manifest) || manifest.length === 0) {
  throw new Error('Manifest must be a non-empty JSON array');
}

let bytes = 0;
for (const item of manifest) {
  const objectPath = String(item.storagePath || '');
  if (
    !objectPath.startsWith('knowledge_bank/') ||
    objectPath.startsWith('/') ||
    objectPath.includes('\\') ||
    objectPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe object path: ${objectPath}`);
  }

  const target = path.resolve(storageRoot, ...objectPath.split('/'));
  const relative = path.relative(storageRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Object path escaped storage root: ${objectPath}`);
  }

  const [file, disk] = await Promise.all([readFile(target), stat(target)]);
  const digest = createHash('sha256').update(file).digest('hex');
  if (disk.size !== Number(item.size) || digest !== item.sha256) {
    throw new Error(
      `Verification mismatch: ${objectPath} size=${disk.size}/${item.size} sha256=${digest}/${item.sha256}`
    );
  }
  bytes += disk.size;
}

console.log(JSON.stringify({ verified: manifest.length, bytes, storageRoot }));
