import path from 'node:path';

export type StorageBackend = 'local';

export function readStorageBackend(env: NodeJS.ProcessEnv = process.env): StorageBackend {
  const value = String(env.STORAGE_BACKEND || 'local')
    .trim()
    .toLowerCase();
  if (value === 'local') return value;
  throw new Error(`Unsupported STORAGE_BACKEND: ${env.STORAGE_BACKEND}`);
}

export function readLocalStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = String(env.STORAGE_LOCAL_ROOT || '').trim();
  if (!root) throw new Error('STORAGE_LOCAL_ROOT is required');
  if (!path.isAbsolute(root)) throw new Error('STORAGE_LOCAL_ROOT must be an absolute path');
  return path.resolve(root);
}

export function readStorageSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = String(env.STORAGE_SIGNING_SECRET || '').trim();
  if (!secret) throw new Error('STORAGE_SIGNING_SECRET is required');
  if (secret.length < 32) {
    throw new Error('STORAGE_SIGNING_SECRET must contain at least 32 characters');
  }
  return secret;
}
