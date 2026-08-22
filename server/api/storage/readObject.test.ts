import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  verifyLocalReadUrl: vi.fn(),
  stat: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock('../lib/storage/objectStore.js', () => ({
  verifyLocalReadUrl: storage.verifyLocalReadUrl,
  getObjectStore: () => ({
    stat: storage.stat,
    createReadStream: storage.createReadStream,
  }),
}));

import { handleReadObject } from './readObject.js';

function response() {
  const res: any = { headersSent: false };
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn();
  return res;
}

describe('signed local object reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.verifyLocalReadUrl.mockReturnValue({
      objectPath: 'documents/report.pdf',
      contentType: 'application/pdf',
      responseDisposition: 'attachment; filename="report.pdf"',
    });
    storage.stat.mockResolvedValue({ size: 128, contentType: 'application/pdf' });
  });

  it('returns metadata headers for a valid HEAD request without opening a stream', async () => {
    const res = response();

    await handleReadObject({ method: 'HEAD', headers: {}, query: { signature: 'ok' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '128');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.end).toHaveBeenCalledOnce();
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('returns 416 for an unsatisfiable byte range', async () => {
    const res = response();

    await handleReadObject(
      { method: 'GET', headers: { range: 'bytes=500-600' }, query: { signature: 'ok' } } as any,
      res
    );

    expect(res.statusCode).toBe(416);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */128');
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('rejects invalid or expired signatures without touching storage', async () => {
    storage.verifyLocalReadUrl.mockImplementation(() => {
      throw Object.assign(new Error('invalid signature'), { statusCode: 403 });
    });
    const res = response();

    await handleReadObject({ method: 'GET', headers: {}, query: {} } as any, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Invalid or expired storage URL' });
    expect(storage.stat).not.toHaveBeenCalled();
  });
});
