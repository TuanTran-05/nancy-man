const FULL_TURN_DEGREES = 360;
const POINTER_ANGLE_DEGREES = 270;

export function normalizeRotation(rotation: number) {
  return ((rotation % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
}

type LuckyWheelSpinTargetOptions = {
  currentRotation: number;
  selectedIndex: number;
  totalSlices: number;
  fullSpins: number;
};

export function getLuckyWheelSpinTarget({
  currentRotation,
  selectedIndex,
  totalSlices,
  fullSpins,
}: LuckyWheelSpinTargetOptions) {
  if (totalSlices <= 0) {
    throw new RangeError('totalSlices must be greater than 0');
  }

  if (selectedIndex < 0 || selectedIndex >= totalSlices) {
    throw new RangeError('selectedIndex must be within the wheel slices');
  }

  const sliceAngle = FULL_TURN_DEGREES / totalSlices;
  const selectedSliceCenter = (selectedIndex + 0.5) * sliceAngle;
  const targetModulo = normalizeRotation(POINTER_ANGLE_DEGREES - selectedSliceCenter);
  const currentModulo = normalizeRotation(currentRotation);
  const forwardDelta = normalizeRotation(targetModulo - currentModulo);

  return {
    sliceAngle,
    targetRotation: currentRotation + fullSpins * FULL_TURN_DEGREES + forwardDelta,
  };
}
