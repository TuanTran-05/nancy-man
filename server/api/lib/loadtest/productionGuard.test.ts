import { describe, expect, it } from 'vitest';
import {
  isProductionLikeTarget,
  assertSafeLoadtestTarget,
} from '../../../../loadtests/lib/productionGuard';

describe('isProductionLikeTarget', () => {
  it('returns true for production domains', () => {
    expect(isProductionLikeTarget('https://vps.thienuy.edu.vn')).toBe(true);
    expect(isProductionLikeTarget('https://www.vps.thienuy.edu.vn')).toBe(true);
  });

  it('returns false for safe domains', () => {
    expect(isProductionLikeTarget('http://localhost:3000')).toBe(false);
    expect(isProductionLikeTarget('https://staging.vps.thienuy.edu.vn')).toBe(false);
    expect(isProductionLikeTarget('https://preview.vps.thienuy.edu.vn')).toBe(false);
  });
});
describe('assertSafeLoadtestTarget', () => {
  it('throws when env is missing', () => {
    expect(() => assertSafeLoadtestTarget({})).toThrow(
      'LOADTEST_ENV must be one of local, test, staging, loadtest, or preview before running mutating load tests.'
    );
  });

  it('throws for production-like target even when env is staging', () => {
    expect(() =>
      assertSafeLoadtestTarget({ env: 'staging', baseUrl: 'https://vps.thienuy.edu.vn' })
    ).toThrow(
      'Refusing to run mutating load test against production-like target: https://vps.thienuy.edu.vn'
    );
  });

  it('allows staging target with env staging', () => {
    expect(() =>
      assertSafeLoadtestTarget({ env: 'staging', baseUrl: 'https://staging.vps.thienuy.edu.vn' })
    ).not.toThrow();
  });
});
