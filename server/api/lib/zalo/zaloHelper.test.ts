import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createDbMock(tokenDoc?: Record<string, unknown>) {
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({
    exists: Boolean(tokenDoc),
    data: () => tokenDoc,
  });
  const doc = vi.fn(() => ({ get, set }));
  const collection = vi.fn(() => ({ doc }));

  return {
    db: { collection },
    get,
    set,
  };
}

async function loadZaloHelper(db: unknown) {
  vi.resetModules();
  vi.doMock('../auth/verifyAuth.js', () => ({
    getDb: () => db,
  }));
  return import('./zaloHelper');
}

function stubRequiredZaloEnv(overrides: Record<string, string> = {}) {
  const defaults = {
    ZALO_APP_ID: 'app-id',
    ZALO_APP_SECRET: 'app-secret',
    ZALO_OA_ID: 'oa-id',
    ZALO_OA_ACCESS_TOKEN: 'env-access',
    ZALO_REFRESH_TOKEN: 'env-refresh',
    ZALO_ZNS_TEMPLATE_ID: 'template-id',
    ZALO_ZNS_OTP_TEMPLATE_ID: 'otp-template-id',
    ZALO_ZNS_EVAL_TEMPLATE_ID: 'eval-template-id',
    ZALO_ZNS_STAFF_TEMPLATE_ID: 'staff-template-id',
    ZALO_ZNS_PAYMENT_TEMPLATE_ID: 'payment-template-id',
    ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID: 'tuition-notice-template-id',
    ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID: 'next-course-tuition-template-id',
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

describe('zaloHelper token fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    stubRequiredZaloEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('falls back to the current env refresh token when the stored DocumentStore token is stale', async () => {
    const dbMock = createDbMock({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      expiresAt: 0,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ error: -2, message: 'Invalid refresh token' }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { getValidAccessToken } = await loadZaloHelper(dbMock.db);

    await expect(getValidAccessToken()).resolves.toBe('fresh-access');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('refresh_token=stored-refresh');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('refresh_token=env-refresh');
    expect(dbMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
      }),
      { merge: true }
    );
  });

  it('uses the configured access token when refresh cannot produce a token', async () => {
    const dbMock = createDbMock({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      expiresAt: 0,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error: -2, message: 'Invalid refresh token' }),
      })
    );

    const { getValidAccessToken } = await loadZaloHelper(dbMock.db);

    await expect(getValidAccessToken()).resolves.toBe('env-access');
  });
});

describe('zaloHelper config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    stubRequiredZaloEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('loads the aggregate tuition reminder template from the existing notice variable', async () => {
    const dbMock = createDbMock();
    stubRequiredZaloEnv({ ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID: 'tuition-notice-template-id' });

    const { getZaloConfig } = await loadZaloHelper(dbMock.db);

    expect(getZaloConfig().znsTuitionNoticeTemplateId).toBe('tuition-notice-template-id');
  });
});

describe('zaloHelper provider errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    stubRequiredZaloEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns the numeric Zalo provider error code with the mapped message', async () => {
    const dbMock = createDbMock({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      expiresAt: Date.now() + 60_000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error: -144, message: 'Daily quota exceeded' }),
      })
    );

    const { sendZaloZNSMessage } = await loadZaloHelper(dbMock.db);

    await expect(
      sendZaloZNSMessage('template-id', { student_name: 'Nguyễn An' }, '84901234567')
    ).resolves.toEqual({
      success: false,
      errorCode: -144,
      error: 'OA đã vượt hạn mức gửi trong ngày: Daily quota exceeded',
    });
  });
});
