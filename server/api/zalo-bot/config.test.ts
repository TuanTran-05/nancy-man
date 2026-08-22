import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadZaloBotConfig } from './config.js';

describe('loadZaloBotConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false and empty strings when disabled', () => {
    process.env.ZALO_BOT_ENABLED = 'false';
    const config = loadZaloBotConfig();
    expect(config.enabled).toBe(false);
    expect(config.adminDataEnabled).toBe(false);
    expect(config.adminIntentsEnabled).toEqual([]);
    expect(config.adminSnapshotRefreshEnabled).toBe(false);
    expect(config.token).toBe('');
  });

  it('throws error when token is missing and enabled is true', () => {
    process.env.ZALO_BOT_ENABLED = 'true';
    process.env.ZALO_BOT_WEBHOOK_SECRET = 'secret123';
    process.env.ZALO_BOT_LINK_CODE_PEPPER = 'pepper';
    process.env.ZALO_BOT_CHAT_HASH_SECRET = 'hashsecret';

    expect(() => loadZaloBotConfig()).toThrow(/ZALO_BOT_TOKEN/);
  });

  it('throws error when webhook secret length is less than 8', () => {
    process.env.ZALO_BOT_ENABLED = 'true';
    process.env.ZALO_BOT_TOKEN = 'token';
    process.env.ZALO_BOT_WEBHOOK_SECRET = 'short';
    process.env.ZALO_BOT_LINK_CODE_PEPPER = 'pepper';
    process.env.ZALO_BOT_CHAT_HASH_SECRET = 'hashsecret';

    expect(() => loadZaloBotConfig()).toThrow(/ZALO_BOT_WEBHOOK_SECRET/);
  });

  it('returns valid config when all required vars are set', () => {
    process.env.ZALO_BOT_ENABLED = 'true';
    process.env.ZALO_BOT_DAILY_DIGEST_ENABLED = 'true';
    process.env.ZALO_BOT_DRY_RUN = 'true';
    process.env.ZALO_BOT_TOKEN = 'mytoken';
    process.env.ZALO_BOT_WEBHOOK_SECRET = 'mysecret123';
    process.env.ZALO_BOT_LINK_CODE_PEPPER = 'mypepper';
    process.env.ZALO_BOT_CHAT_HASH_SECRET = 'myhashsecret';
    process.env.APP_URL = 'https://vps.thienuy.edu.vn/';

    const config = loadZaloBotConfig();
    expect(config.enabled).toBe(true);
    expect(config.dailyDigestEnabled).toBe(true);
    expect(config.dryRun).toBe(true);
    expect(config.token).toBe('mytoken');
    expect(config.appUrl).toBe('https://vps.thienuy.edu.vn');
  });

  it.each(['TRUE', '1', 'yes'])('rejects invalid boolean value %s', (value) => {
    process.env.ZALO_BOT_ENABLED = value;
    expect(() => loadZaloBotConfig()).toThrow(/ZALO_BOT_ENABLED/);
  });

  it.each(['NaN', '999', '60001', '1500.5'])('rejects invalid request timeout %s', (value) => {
    process.env.ZALO_BOT_REQUEST_TIMEOUT_MS = value;
    expect(() => loadZaloBotConfig()).toThrow(/ZALO_BOT_REQUEST_TIMEOUT_MS/);
  });

  describe('adminDataEnabled and capabilities', () => {
    it('parses valid admin intent capabilities and pilot uids', () => {
      process.env.ZALO_BOT_ADMIN_DATA_ENABLED = 'true';
      process.env.ZALO_BOT_ADMIN_INTENTS_ENABLED =
        'admin_student_lookup, admin_center_finance, admin_student_phone';
      process.env.ZALO_BOT_ADMIN_PILOT_UIDS = 'admin_u1, admin_u2';
      process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS = '90';
      process.env.ZALO_BOT_CHAT_HASH_SECRET = 'admin-audit-secret';
      process.env.GEMINI_API_KEY = 'gemini-test-key';

      const config = loadZaloBotConfig();
      expect(config.adminDataEnabled).toBe(true);
      expect(config.adminIntentsEnabled).toEqual([
        'admin_student_lookup',
        'admin_center_finance',
        'admin_student_phone',
      ]);
      expect(config.adminPilotUids).toEqual(['admin_u1', 'admin_u2']);
      expect(config.adminReadAuditRetentionDays).toBe(90);
    });

    it('fails closed when the admin audit HMAC secret is missing or too short', () => {
      process.env.ZALO_BOT_ADMIN_DATA_ENABLED = 'true';
      process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS = '90';
      process.env.ZALO_BOT_CHAT_HASH_SECRET = 'too-short';
      process.env.GEMINI_API_KEY = 'gemini-test-key';

      expect(() => loadZaloBotConfig()).toThrow(/at least 16 characters/);
    });

    it('requires Gemini classification when the admin assistant is enabled', () => {
      process.env.ZALO_BOT_ADMIN_DATA_ENABLED = 'true';
      process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS = '90';
      process.env.ZALO_BOT_CHAT_HASH_SECRET = 'admin-audit-secret';
      delete process.env.GEMINI_API_KEY;

      expect(() => loadZaloBotConfig()).toThrow(/Missing GEMINI_API_KEY for Zalo admin data/);
    });

    it('rejects unknown admin intent capability in ZALO_BOT_ADMIN_INTENTS_ENABLED', () => {
      process.env.ZALO_BOT_ADMIN_INTENTS_ENABLED = 'admin_student_lookup, invalid_intent_name';
      expect(() => loadZaloBotConfig()).toThrow(
        /Invalid intent capability in ZALO_BOT_ADMIN_INTENTS_ENABLED/
      );
    });

    it('requires ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS when ZALO_BOT_ADMIN_DATA_ENABLED is true', () => {
      process.env.ZALO_BOT_ADMIN_DATA_ENABLED = 'true';
      delete process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS;
      expect(() => loadZaloBotConfig()).toThrow(/ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS/);
    });

    it.each(['10', '400', 'invalid'])('rejects out-of-range retention days %s', (retentionVal) => {
      process.env.ZALO_BOT_ADMIN_DATA_ENABLED = 'true';
      process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS = retentionVal;
      expect(() => loadZaloBotConfig()).toThrow(
        /ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS must be an integer between 30 and 365/
      );
    });
  });

  describe('chatEnabled', () => {
    it('defaults to false when ZALO_BOT_CHAT_ENABLED is unset', () => {
      delete process.env.ZALO_BOT_CHAT_ENABLED;
      expect(loadZaloBotConfig().chatEnabled).toBe(false);
    });

    it('reads true from ZALO_BOT_CHAT_ENABLED', () => {
      process.env.ZALO_BOT_CHAT_ENABLED = 'true';
      expect(loadZaloBotConfig().chatEnabled).toBe(true);
    });

    it('rejects a non-boolean ZALO_BOT_CHAT_ENABLED', () => {
      process.env.ZALO_BOT_CHAT_ENABLED = 'yes';
      expect(() => loadZaloBotConfig()).toThrow(
        'ZALO_BOT_CHAT_ENABLED must be either true or false'
      );
    });

    it('requires GEMINI_API_KEY when bot and chat are both enabled', () => {
      process.env.ZALO_BOT_ENABLED = 'true';
      process.env.ZALO_BOT_TOKEN = 'token';
      process.env.ZALO_BOT_WEBHOOK_SECRET = 'secret-value';
      process.env.ZALO_BOT_LINK_CODE_PEPPER = 'pepper';
      process.env.ZALO_BOT_CHAT_HASH_SECRET = 'chat-hash';
      process.env.ZALO_BOT_CHAT_ENABLED = 'true';
      delete process.env.GEMINI_API_KEY;

      try {
        loadZaloBotConfig();
        throw new Error('Expected loadZaloBotConfig to throw');
      } catch (error) {
        expect(error).toMatchObject({
          message: 'Missing GEMINI_API_KEY',
          statusCode: 503,
        });
      }
    });

    it('does not require GEMINI_API_KEY when chat is disabled', () => {
      process.env.ZALO_BOT_ENABLED = 'true';
      process.env.ZALO_BOT_TOKEN = 'token';
      process.env.ZALO_BOT_WEBHOOK_SECRET = 'secret-value';
      process.env.ZALO_BOT_LINK_CODE_PEPPER = 'pepper';
      process.env.ZALO_BOT_CHAT_HASH_SECRET = 'chat-hash';
      process.env.ZALO_BOT_CHAT_ENABLED = 'false';
      delete process.env.GEMINI_API_KEY;
      expect(() => loadZaloBotConfig()).not.toThrow();
    });
  });
});
