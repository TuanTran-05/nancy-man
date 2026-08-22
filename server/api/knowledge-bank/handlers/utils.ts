import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import formidable from 'formidable';
import { getObjectStore } from '../../lib/storage/objectStore.js';

export const MAX_FILE_SIZE = 4 * 1024 * 1024;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PROGRAM_NAME_LENGTH = 200;
export const GLOBAL_SUCCESS_GRADES = new Set([6, 7, 8, 9]);

export const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Magic byte signatures for allowed file types
export const MAGIC_SIGNATURES: Record<string, Buffer[]> = {
  pdf: [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // PK.. (ZIP format)
};

export function verifyFileSignature(buffer: Buffer, ext: string): boolean {
  const signatures = MAGIC_SIGNATURES[ext];
  if (!signatures) return false;
  return signatures.some(
    (sig) => buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)
  );
}

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function sanitizeFilename(filename: string, fallbackExt: string): string {
  const fallback = `document.${fallbackExt}`;
  const safe = (filename || fallback)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return safe || fallback;
}

export function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function formatClientError(
  err: unknown,
  fallbackMessage: string,
  payloadTooLargeMessage?: string
): { statusCode: number; error: string } {
  const statusCode =
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
  if (statusCode === 413 && payloadTooLargeMessage) {
    return { statusCode, error: payloadTooLargeMessage };
  }
  return {
    statusCode,
    error:
      statusCode >= 500
        ? fallbackMessage
        : err instanceof Error
          ? err.message || fallbackMessage
          : fallbackMessage,
  };
}

export async function createSignedReadUrl(
  storagePath: string,
  options: { contentType?: string; expiresMs?: number } = {}
): Promise<string> {
  return getObjectStore().createSignedReadUrl(storagePath, options);
}

export async function readJsonBody(req: ApiRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export async function parseSingleFileForm(req: ApiRequest, maxFileSize: number) {
  const form = formidable({
    maxFileSize,
    maxFiles: 1,
  });
  const [fields, files] = await form.parse(req);
  const uploadedFile = files.file?.[0];
  return { fields, uploadedFile };
}

export async function saveImageFile(
  file: formidable.File,
  storagePath: string,
  fallbackExt: string,
  options: { createDownloadToken?: boolean } = { createDownloadToken: true }
): Promise<{ url: string; storagePath: string }> {
  const filename = file.originalFilename || `image.${fallbackExt}`;
  const ext = getExt(filename) || fallbackExt;
  const expectedMime = ALLOWED_IMAGE_TYPES[ext];
  const actualMime = file.mimetype || '';

  if (!expectedMime || actualMime !== expectedMime) {
    throw Object.assign(new Error('Invalid image type. Only jpg, png, and webp are allowed.'), {
      statusCode: 400,
    });
  }

  const store = getObjectStore();
  const persistentUrl = options.createDownloadToken === true;
  await store.save(storagePath, readFileSync(file.filepath), {
    contentType: expectedMime,
  });

  return {
    storagePath,
    url: persistentUrl
      ? await store.createPersistentReadUrl(storagePath, { contentType: expectedMime })
      : await createSignedReadUrl(storagePath, { contentType: expectedMime }),
  };
}
