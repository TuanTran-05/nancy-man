export interface LoadtestTargetInput {
  baseUrl?: string;
  env?: string;
}

const SAFE_ENVS = new Set(['local', 'test', 'staging', 'loadtest', 'preview']);

export function isProductionLikeTarget(baseUrl = '') {
  const normalized = baseUrl.toLowerCase().trim();
  if (!normalized) return false;
  try {
    const hostname = new URL(normalized).hostname;
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;
    return !['staging', 'preview', 'test', 'loadtest', 'dev'].some((marker) =>
      hostname.includes(marker)
    );
  } catch {
    return true;
  }
}

export function assertSafeLoadtestTarget(input: LoadtestTargetInput = {}) {
  const env = String(input.env || '')
    .toLowerCase()
    .trim();
  const baseUrl = String(input.baseUrl || '');
  if (!SAFE_ENVS.has(env)) {
    throw new Error(
      'LOADTEST_ENV must be one of local, test, staging, loadtest, or preview before running mutating load tests.'
    );
  }
  if (isProductionLikeTarget(baseUrl)) {
    throw new Error(
      `Refusing to run mutating load test against production-like target: ${baseUrl}`
    );
  }
}

export function assertSafeLoadtestEnvironment() {
  assertSafeLoadtestTarget({ baseUrl: process.env.BASE_URL, env: process.env.LOADTEST_ENV });
}
