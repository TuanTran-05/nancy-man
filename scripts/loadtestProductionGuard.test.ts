import { describe, expect, it } from 'vitest';
import { isProductionLikeTarget } from '../loadtests/lib/productionGuard';

describe('isProductionLikeTarget', () => {
  it('recognizes the real vps.thienuy.edu.vn domain as production', () => {
    expect(isProductionLikeTarget('https://vps.thienuy.edu.vn')).toBe(true);
    expect(isProductionLikeTarget('https://www.vps.thienuy.edu.vn')).toBe(true);
  });
});
