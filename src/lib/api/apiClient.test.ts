import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, apiRequestDetailed } from './apiClient';

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('token-1'),
    },
  },
}));

function mockFetch(status: number, body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ ETag: 'etag-1' }),
      text: vi.fn().mockResolvedValue(body),
    })
  );
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns JSON when success is true', async () => {
    mockFetch(200, JSON.stringify({ success: true, data: { id: 'ok' } }));
    await expect(apiRequest('/api/test')).resolves.toEqual({ success: true, data: { id: 'ok' } });
  });

  it.each([false, null, 0, '', 'yes'])('throws when success is %s', async (success) => {
    mockFetch(200, JSON.stringify({ success, error: 'Bad contract' }));
    await expect(apiRequest('/api/test')).rejects.toMatchObject({ name: 'ApiError' });
  });

  it('throws on an empty body for the default JSON client', async () => {
    mockFetch(204, '');
    await expect(apiRequest('/api/test')).rejects.toMatchObject({ name: 'ApiError' });
  });

  it('returns headers without parsing an empty 304 response', async () => {
    mockFetch(304, '');

    const response = await apiRequestDetailed('/api/test', {
      headers: { 'If-None-Match': 'etag-1' },
    });

    expect(response).toMatchObject({ status: 304, data: null });
    expect(response.headers.get('ETag')).toBe('etag-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': 'etag-1' }),
      })
    );
  });

  it('throws the server error message for non-ok responses', async () => {
    mockFetch(400, JSON.stringify({ success: false, error: 'Invalid input' }));
    await expect(apiRequest('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Invalid input',
    });
  });
});
