export function shouldSendTuitionNotice(input: {
  sendable: boolean;
  tuitionPreviouslySent: boolean;
  tuitionOnly: boolean;
  forceTuitionResend: boolean;
}): boolean {
  if (!input.sendable) return false;
  if (!input.tuitionPreviouslySent) return true;
  return input.tuitionOnly && input.forceTuitionResend;
}

export function assertExpectedTuitionResend(input: {
  actualTuition: number;
  actualTargetCount: number;
  expectedTuition?: number;
  expectedTargetCount?: number;
}): void {
  if (
    input.expectedTuition !== undefined &&
    input.actualTuition !== input.expectedTuition
  ) {
    throw new Error(
      `Expected tuition ${input.expectedTuition}, received ${input.actualTuition}`
    );
  }
  if (
    input.expectedTargetCount !== undefined &&
    input.actualTargetCount !== input.expectedTargetCount
  ) {
    throw new Error(
      `Expected target count ${input.expectedTargetCount}, received ${input.actualTargetCount}`
    );
  }
}
