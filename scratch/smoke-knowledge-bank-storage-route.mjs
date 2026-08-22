import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error('Usage: node smoke-knowledge-bank-storage-route.mjs <manifest>');
}

const secret = String(process.env.STORAGE_SIGNING_SECRET || '');
if (secret.length < 32) throw new Error('STORAGE_SIGNING_SECRET is unavailable');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Manifest has no test objects');

let bytes = 0;
const contentTypes = new Set();
for (const item of manifest) {
  if (!item?.storagePath || !item?.sha256) throw new Error('Manifest object is incomplete');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const contentType = item.contentType || 'application/octet-stream';
  const payload = [item.storagePath, String(expiresAt), contentType, ''].join('\n');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  const params = new URLSearchParams({
    path: item.storagePath,
    expires: String(expiresAt),
    signature,
    type: contentType,
  });

  const response = await fetch(`http://127.0.0.1:3000/api/v1/files/read?${params}`);
  if (!response.ok) {
    throw new Error(`Storage route returned HTTP ${response.status} for ${item.storagePath}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== Number(item.size) || digest !== item.sha256) {
    throw new Error(
      `Storage route content mismatch for ${item.storagePath}: size=${buffer.length}/${item.size} sha256=${digest}/${item.sha256}`
    );
  }
  bytes += buffer.length;
  contentTypes.add(response.headers.get('content-type') || '');
}

console.log(
  JSON.stringify({
    route: '/api/v1/files/read',
    verified: manifest.length,
    bytes,
    contentTypes: [...contentTypes].sort(),
  })
);
