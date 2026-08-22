import { describe, expect, it } from 'vitest';
import { getLuckyWheelSpinTarget, normalizeRotation } from './luckyWheelSpin';

describe('getLuckyWheelSpinTarget', () => {
  it('keeps later spins moving forward by the requested full rotations', () => {
    const firstSpin = getLuckyWheelSpinTarget({
      currentRotation: 0,
      selectedIndex: 3,
      totalSlices: 12,
      fullSpins: 5,
    });

    const nextSpin = getLuckyWheelSpinTarget({
      currentRotation: firstSpin.targetRotation,
      selectedIndex: 2,
      totalSlices: 12,
      fullSpins: 5,
    });

    expect(nextSpin.targetRotation - firstSpin.targetRotation).toBeGreaterThanOrEqual(5 * 360);
    expect(nextSpin.targetRotation - firstSpin.targetRotation).toBeLessThan(6 * 360);
  });

  it('lands the selected slice center under the top pointer', () => {
    const selectedIndex = 4;
    const target = getLuckyWheelSpinTarget({
      currentRotation: 1234,
      selectedIndex,
      totalSlices: 10,
      fullSpins: 5,
    });

    const selectedSliceCenter = (selectedIndex + 0.5) * target.sliceAngle;

    expect(normalizeRotation(target.targetRotation + selectedSliceCenter)).toBeCloseTo(270);
  });
});
