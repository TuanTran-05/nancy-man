import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from './validateEnv.js';

const REQUIRED_ENV = {
  APP_URL: 'https://vps.thienuy.edu.vn',
  DATABASE_URL: 'postgres://edutrack:test@127.0.0.1:5432/edutrack',
  SESSION_SECRET: 'session-secret-at-least-32-characters',
  STORAGE_LOCAL_ROOT: 'C:\\edutrack\\uploads',
  STORAGE_SIGNING_SECRET: 'storage-signing-secret-at-least-32-characters',
  OTP_PEPPER: 'pepper',
  CRON_SECRET: 'cron-secret',
  LOOKUP_CHALLENGE_SECRET: 'lookup-secret',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  VITE_TURNSTILE_SITE_KEY: 'turnstile-site-key',
  PAYOS_CLIENT_ID: 'payos-client',
  PAYOS_API_KEY: 'payos-api-key',
  PAYOS_CHECKSUM_KEY: 'payos-checksum',
  PAYOS_RETURN_URL: 'https://vps.thienuy.edu.vn/parent/tuition',
  PAYOS_CANCEL_URL: 'https://vps.thienuy.edu.vn/parent/tuition',
};

describe('validateEnv', () => {
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws instead of terminating the process when core config is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => validateEnv()).toThrow(/Missing core environment variables: DATABASE_URL/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of terminating the process when production lookup secret is missing', () => {
    delete process.env.LOOKUP_CHALLENGE_SECRET;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).toThrow(/LOOKUP_CHALLENGE_SECRET/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws when production OTP pepper is missing', () => {
    delete process.env.OTP_PEPPER;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).toThrow(/OTP_PEPPER/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws when production cron secret is missing', () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).toThrow(/CRON_SECRET/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('allows production startup and disables PayOS when its credentials are missing', () => {
    delete process.env.PAYOS_API_KEY;
    delete process.env.PAYOS_CHECKSUM_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('PayOS integration disabled')
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws when production Turnstile secret is missing', () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws when production Turnstile site key is missing', () => {
    delete process.env.VITE_TURNSTILE_SITE_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => validateEnv()).toThrow(/VITE_TURNSTILE_SITE_KEY/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('refuses unsafe side-effect switches at staging runtime', () => {
    process.env.DEPLOYMENT_STAGE = 'staging';
    process.env.ZALO_BOT_ENABLED = 'true';
    process.env.ZALO_BOT_DAILY_DIGEST_ENABLED = 'true';
    process.env.ZALO_BOT_DRY_RUN = 'false';
    process.env.ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED = 'true';

    expect(() => validateEnv()).toThrow(/Unsafe staging environment/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('rejects the obsolete legacy canonical-read mode instead of silently falling back', () => {
    process.env.CANONICAL_STUDENT_READ_MODE = 'legacy';

    expect(() => validateEnv()).toThrow(/CANONICAL_STUDENT_READ_MODE/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
