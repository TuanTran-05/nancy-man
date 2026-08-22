import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { pipeline } from 'node:stream/promises';
import { getObjectStore, verifyLocalReadUrl } from '../lib/storage/objectStore.js';

function safeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 500);
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : Number.NaN;
  let end = match[2] ? Number(match[2]) : Number.NaN;
  if (Number.isNaN(start) && Number.isFinite(end)) {
    const suffixLength = Math.min(end, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    if (!Number.isFinite(start)) return null;
    if (!Number.isFinite(end)) end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return null;
  }
  if (start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function handleReadObject(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const signed = verifyLocalReadUrl(req.query as Record<string, unknown>);
    const store = getObjectStore();
    const metadata = await store.stat(signed.objectPath);
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const range = parseRange(rangeHeader, metadata.size);
    if (rangeHeader && !range) {
      res.setHeader('Content-Range', `bytes */${metadata.size}`);
      return res.status(416).end();
    }

    const contentType = signed.contentType || metadata.contentType || 'application/octet-stream';
    res.setHeader('Content-Type', safeHeaderValue(contentType));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (signed.responseDisposition) {
      res.setHeader('Content-Disposition', safeHeaderValue(signed.responseDisposition));
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(metadata.size));
    }
    if (req.method === 'HEAD') return res.end();

    await pipeline(store.createReadStream(signed.objectPath, range || undefined), res as never);
    return;
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
          ? 404
          : 500;
    if (res.headersSent) return;
    return res.status(statusCode).json({
      success: false,
      error:
        statusCode === 404
          ? 'Stored object not found'
          : statusCode === 403
            ? 'Invalid or expired storage URL'
            : 'Failed to read stored object',
    });
  }
}
