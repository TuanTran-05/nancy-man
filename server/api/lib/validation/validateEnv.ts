/**
 * Startup environment variable validation.
 * Call once at server boot, before opening external connections.
 *
 * Tiered validation:
 * - CORE: required for the app to function at all (throws if missing)
 * - FEATURE: required for specific features (warning only, feature degrades gracefully)
 */

const CORE_VARS = [
  'APP_URL',
  'DATABASE_URL',
  'SESSION_SECRET',
  'STORAGE_LOCAL_ROOT',
  'STORAGE_SIGNING_SECRET',
  'OTP_PEPPER',
  'CRON_SECRET',
] as const;

const PRODUCTION_OPERATIONAL_VARS = [
  'LOOKUP_CHALLENGE_SECRET',
  'OTP_PEPPER',
  'CRON_SECRET',
  'TURNSTILE_SECRET_KEY',
  'VITE_TURNSTILE_SITE_KEY',
] as const;

const PAYOS_VARS = [
  'PAYOS_CLIENT_ID',
  'PAYOS_API_KEY',
  'PAYOS_CHECKSUM_KEY',
  'PAYOS_RETURN_URL',
  'PAYOS_CANCEL_URL',
] as const;

const ZALO_VARS = [
  'ZALO_APP_ID',
  'ZALO_APP_SECRET',
  'ZALO_OA_ID',
  'ZALO_OA_ACCESS_TOKEN',
  'ZALO_REFRESH_TOKEN',
  'ZALO_ZNS_TEMPLATE_ID',
  'ZALO_ZNS_OTP_TEMPLATE_ID',
  'ZALO_ZNS_EVAL_TEMPLATE_ID',
  'ZALO_ZNS_STAFF_TEMPLATE_ID',
  'ZALO_ZNS_PAYMENT_TEMPLATE_ID',
  'ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID',
  'ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID',
] as const;

/**
 * Validates that all required environment variables are set.
 * Core vars: throws if missing.
 * Feature vars: logs warning only.
 */
export function getCoreEnvironmentReadiness(): {
  ready: boolean;
  missing: readonly string[];
} {
  const missing = CORE_VARS.filter((variable) => !process.env[variable]);
  return { ready: missing.length === 0, missing };
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === 'production';
}

export function getProductionEnvironmentReadiness(): {
  ready: boolean;
  missing: readonly string[];
} {
  if (!isProductionEnvironment()) return { ready: true, missing: [] };
  const missing: string[] = [
    ...PRODUCTION_OPERATIONAL_VARS.filter((variable) => !process.env[variable]),
  ];
  return { ready: missing.length === 0, missing };
}

function validateStagingSafety(): void {
  if (process.env.DEPLOYMENT_STAGE !== 'staging') return;

  const unsafeSettings: string[] = [];
  if (process.env.ZALO_BOT_ENABLED !== 'false') unsafeSettings.push('ZALO_BOT_ENABLED=false');
  if (process.env.ZALO_BOT_DAILY_DIGEST_ENABLED !== 'false') {
    unsafeSettings.push('ZALO_BOT_DAILY_DIGEST_ENABLED=false');
  }
  if (process.env.ZALO_BOT_DRY_RUN !== 'true') unsafeSettings.push('ZALO_BOT_DRY_RUN=true');
  if (process.env.ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED !== 'false') {
    unsafeSettings.push('ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED=false');
  }

  if (unsafeSettings.length > 0) {
    throw new Error(`Unsafe staging environment: ${unsafeSettings.join(', ')}`);
  }
}

function validateCanonicalStudentReadMode(): void {
  const mode = process.env.CANONICAL_STUDENT_READ_MODE;
  if (
    mode &&
    !['legacy_compare', 'canonical_preferred', 'canonical_required'].includes(mode)
  ) {
    throw new Error(
      'CANONICAL_STUDENT_READ_MODE must be legacy_compare, canonical_preferred, or canonical_required'
    );
  }
}

export function validateEnv(): void {
  const readiness = getCoreEnvironmentReadiness();
  if (!readiness.ready) {
    const message = `Missing core environment variables: ${readiness.missing.join(', ')}`;
    console.error(`[FATAL] ${message}`);
    console.error('Set these in your .env file or deployment environment.');
    throw new Error(message);
  }

  const productionReadiness = getProductionEnvironmentReadiness();
  if (!productionReadiness.ready) {
    const message = `Missing production operational environment variables: ${productionReadiness.missing.join(', ')}`;
    console.error(`[FATAL] ${message}`);
    throw new Error(message);
  }

  validateStagingSafety();
  validateCanonicalStudentReadMode();

  const missingPayos = PAYOS_VARS.filter((v) => !process.env[v]);
  if (missingPayos.length > 0) {
    console.warn(`[WARN] PayOS integration disabled — missing: ${missingPayos.join(', ')}`);
  }

  const missingZalo = ZALO_VARS.filter((v) => !process.env[v]);
  if (missingZalo.length > 0) {
    console.warn(`[WARN] Zalo integration disabled — missing: ${missingZalo.join(', ')}`);
  }

  if (!process.env.LOOKUP_CHALLENGE_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      const message =
        'LOOKUP_CHALLENGE_SECRET is required in production — password reset tokens will fail';
      console.error(`[FATAL] ${message}`);
      throw new Error(message);
    } else {
      console.warn(
        `[WARN] LOOKUP_CHALLENGE_SECRET not set — password reset tokens will use dev fallback`
      );
    }
  }
}
