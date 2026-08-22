import { describe, expect, it } from 'vitest';
import {
  assertExpectedTuitionResend,
  shouldSendTuitionNotice,
} from './resend-office-academic-zalo-policy';

describe('shouldSendTuitionNotice', () => {
  it('keeps the existing duplicate guard by default', () => {
    expect(
      shouldSendTuitionNotice({
        sendable: true,
        tuitionPreviouslySent: true,
        tuitionOnly: true,
        forceTuitionResend: false,
      })
    ).toBe(false);
  });

  it('selects an already-sent notice only for forced tuition-only resends', () => {
    expect(
      shouldSendTuitionNotice({
        sendable: true,
        tuitionPreviouslySent: true,
        tuitionOnly: true,
        forceTuitionResend: true,
      })
    ).toBe(true);
  });

  it('does not force a resend when evaluation messages are enabled', () => {
    expect(
      shouldSendTuitionNotice({
        sendable: true,
        tuitionPreviouslySent: true,
        tuitionOnly: false,
        forceTuitionResend: true,
      })
    ).toBe(false);
  });

  it('does not select an ineligible student even in forced mode', () => {
    expect(
      shouldSendTuitionNotice({
        sendable: false,
        tuitionPreviouslySent: true,
        tuitionOnly: true,
        forceTuitionResend: true,
      })
    ).toBe(false);
  });
});

describe('assertExpectedTuitionResend', () => {
  it('accepts matching live tuition and target count', () => {
    expect(() =>
      assertExpectedTuitionResend({
        actualTuition: 1_200_000,
        actualTargetCount: 10,
        expectedTuition: 1_200_000,
        expectedTargetCount: 10,
      })
    ).not.toThrow();
  });

  it('throws when the live tuition differs from the operator expectation', () => {
    expect(() =>
      assertExpectedTuitionResend({
        actualTuition: 1_198_000,
        actualTargetCount: 10,
        expectedTuition: 1_200_000,
        expectedTargetCount: 10,
      })
    ).toThrow('Expected tuition 1200000, received 1198000');
  });

  it('throws when the live target count differs from the operator expectation', () => {
    expect(() =>
      assertExpectedTuitionResend({
        actualTuition: 1_200_000,
        actualTargetCount: 9,
        expectedTuition: 1_200_000,
        expectedTargetCount: 10,
      })
    ).toThrow('Expected target count 10, received 9');
  });
});
