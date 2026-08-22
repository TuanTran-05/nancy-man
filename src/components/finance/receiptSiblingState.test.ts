import { describe, expect, it } from 'vitest';
import { deriveReceiptSiblingState } from './receiptSiblingState';

const student = {
  id: 'a',
  siblingGroupId: 'g1',
  studentLifecycle: 'enrolled',
  enrollmentStatus: 'active',
};
const sibling = {
  id: 'b',
  siblingGroupId: 'g1',
  studentLifecycle: 'enrolled',
  enrollmentStatus: 'active',
};

const base = {
  student,
  pool: [student, sibling],
  ledgerAmount: 1_000_000,
  siblingDiscountTotal: 0,
  discountType: 'none' as const,
  siblingWaived: false,
};

describe('deriveReceiptSiblingState', () => {
  it('shows the available view with the full grant for an eligible student', () => {
    const result = deriveReceiptSiblingState(base);
    expect(result.view).toBe('available');
    expect(result.availableSiblingGrant).toBe(100_000);
    expect(result.siblingGrant).toBe(100_000);
    expect(result.eligibility.eligible).toBe(true);
  });

  it('shows the ineligible view for an unlinked student', () => {
    const result = deriveReceiptSiblingState({
      ...base,
      student: { id: 'a' },
      pool: [{ id: 'a' }],
    });
    expect(result.view).toBe('ineligible');
    expect(result.siblingGrant).toBe(0);
  });

  it('shows the already_granted view once the entitlement is spent', () => {
    const result = deriveReceiptSiblingState({ ...base, siblingDiscountTotal: 100_000 });
    expect(result.view).toBe('already_granted');
    expect(result.availableSiblingGrant).toBe(0);
    expect(result.siblingGrant).toBe(0);
  });

  it('keeps availableSiblingGrant positive while zeroing siblingGrant when waived', () => {
    const result = deriveReceiptSiblingState({ ...base, siblingWaived: true });
    expect(result.availableSiblingGrant).toBe(100_000);
    expect(result.siblingGrant).toBe(0);
    expect(result.view).toBe('available');
  });

  it('shows the full_waiver view regardless of eligibility', () => {
    const result = deriveReceiptSiblingState({ ...base, discountType: 'full_waiver' });
    expect(result.view).toBe('full_waiver');
    expect(result.siblingGrant).toBe(0);
  });

  it('has no student selected yet', () => {
    const result = deriveReceiptSiblingState({ ...base, student: undefined, pool: [] });
    expect(result.view).toBe('ineligible');
    expect(result.eligibility.reason).toBe('no_group');
  });
});
