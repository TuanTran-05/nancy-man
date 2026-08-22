import { describe, expect, it } from 'vitest';
import { computeReceiptDiscount } from './receiptDiscount.js';

const ledger = { amount: 1_000_000, paidTotal: 0, discountTotal: 0 };

function run(overrides: Record<string, unknown> = {}) {
  return computeReceiptDiscount({
    ledger,
    body: {},
    discountType: 'none',
    amountReceived: 1_000_000,
    siblingEligible: false,
    siblingClaimed: false,
    siblingWaived: false,
    siblingWaivedReason: '',
    ...overrides,
  } as Parameters<typeof computeReceiptDiscount>[0]);
}

describe('computeReceiptDiscount', () => {
  it('returns a zero discount and only originalAmount for a plain receipt', () => {
    const result = run();
    expect(result.receiptDiscount).toBe(0);
    expect(result.discountFields).toEqual({ originalAmount: 1_000_000 });
  });

  it('carries the client discount amount for a scholarship receipt', () => {
    const result = run({
      discountType: 'first_prize',
      body: { discountAmount: 100_000, discountPercent: 10 },
      amountReceived: 900_000,
    });
    expect(result.receiptDiscount).toBe(100_000);
    expect(result.discountFields).toMatchObject({
      discountType: 'first_prize',
      discountPercent: 10,
      discountAmount: 100_000,
    });
  });

  it('forces a full waiver to the whole remaining amount', () => {
    const result = run({ discountType: 'full_waiver', amountReceived: 0 });
    expect(result.receiptDiscount).toBe(1_000_000);
    expect(result.discountFields).toMatchObject({ discountPercent: 100, discountAmount: 1_000_000 });
  });

  it('rejects a full waiver that also receives money', () => {
    expect(() => run({ discountType: 'full_waiver', amountReceived: 1 })).toThrow(
      'Full waiver cannot include a received amount'
    );
  });

  it('rejects a full waiver when nothing is outstanding', () => {
    expect(() =>
      run({
        discountType: 'full_waiver',
        amountReceived: 0,
        ledger: { amount: 1_000_000, paidTotal: 1_000_000, discountTotal: 0 },
      })
    ).toThrow('No remaining tuition to waive');
  });

  it('rejects a non-positive amount outside a full waiver', () => {
    expect(() => run({ amountReceived: 0 })).toThrow('Amount must be greater than zero');
  });

  it('rejects a discount larger than the outstanding balance', () => {
    expect(() =>
      run({ discountType: 'custom', body: { discountAmount: 2_000_000 }, amountReceived: 1 })
    ).toThrow('Invalid discount amount');
  });

  it('rejects an amount exceeding what is left after the discount', () => {
    expect(() =>
      run({ discountType: 'first_prize', body: { discountAmount: 100_000 }, amountReceived: 950_000 })
    ).toThrow('Amount exceeds remaining tuition');
  });

  it('prefers an explicit originalAmount from the body', () => {
    expect(run({ body: { originalAmount: 1_200_000 } }).discountFields.originalAmount).toBe(
      1_200_000
    );
  });

  it('passes a discount reason through', () => {
    const result = run({
      discountType: 'custom',
      body: { discountAmount: 50_000, discountReason: 'Hoan canh kho khan' },
      amountReceived: 950_000,
    });
    expect(result.discountFields.discountReason).toBe('Hoan canh kho khan');
  });

  it('attaches statusCode 400 to validation errors', () => {
    expect.assertions(1);
    try {
      run({ amountReceived: 0 });
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });
});

const eligibleDefaults = {
  siblingEligible: true,
  siblingClaimed: false,
  siblingWaived: false,
  siblingWaivedReason: '',
};

describe('computeReceiptDiscount sibling grant', () => {
  it('grants 10% on a sibling-only receipt', () => {
    const result = run({ ...eligibleDefaults, amountReceived: 900_000 });
    expect(result.siblingGrant).toBe(100_000);
    expect(result.receiptDiscount).toBe(100_000);
    expect(result.discountFields).toMatchObject({
      siblingDiscount: true,
      siblingDiscountAmount: 100_000,
      discountAmount: 100_000,
    });
  });

  it('adds the grant on top of a base scholarship', () => {
    const result = run({
      ...eligibleDefaults,
      discountType: 'first_prize',
      body: { discountAmount: 100_000 },
      amountReceived: 800_000,
    });
    expect(result.receiptDiscount).toBe(200_000);
    expect(result.discountFields).toMatchObject({
      discountAmount: 200_000,
      siblingDiscountAmount: 100_000,
    });
  });

  it('stacks on top of a custom discount', () => {
    const result = run({
      ...eligibleDefaults,
      discountType: 'custom',
      body: { discountAmount: 300_000 },
      amountReceived: 600_000,
    });
    expect(result.receiptDiscount).toBe(400_000);
    expect(result.discountFields).toMatchObject({ siblingDiscountAmount: 100_000 });
  });

  it('grants nothing when the ledger entitlement is already spent', () => {
    const result = run({
      ...eligibleDefaults,
      siblingClaimed: false,
      ledger: { amount: 1_000_000, paidTotal: 100_000, discountTotal: 100_000, siblingDiscountTotal: 100_000 },
      amountReceived: 800_000,
    });
    expect(result.siblingGrant).toBe(0);
    expect(result.discountFields).not.toHaveProperty('siblingDiscount');
    expect(result.discountFields).not.toHaveProperty('siblingDiscountAmount');
  });

  it('rejects a stale client claim when the entitlement is already spent', () => {
    try {
      run({
        ...eligibleDefaults,
        siblingClaimed: true,
        ledger: { amount: 1_000_000, siblingDiscountTotal: 100_000 },
        amountReceived: 900_000,
      });
      throw new Error('expected stale entitlement error');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, errorCode: 'stale_sibling_entitlement' });
    }
  });

  it('grants only the shortfall on a partly-used entitlement', () => {
    const result = run({
      ...eligibleDefaults,
      ledger: { amount: 1_000_000, paidTotal: 0, discountTotal: 40_000, siblingDiscountTotal: 40_000 },
      amountReceived: 900_000,
    });
    expect(result.siblingGrant).toBe(60_000);
  });

  it('rejects a sibling claim from an ineligible student', () => {
    expect(() =>
      run({ ...eligibleDefaults, siblingEligible: false, siblingClaimed: true, amountReceived: 900_000 })
    ).toThrow('Student is not eligible for the sibling scholarship');
  });

  it('records a waiver with its reason and grants nothing', () => {
    const result = run({
      ...eligibleDefaults,
      siblingWaived: true,
      siblingWaivedReason: 'Phu huynh tu choi',
    });
    expect(result.siblingGrant).toBe(0);
    expect(result.discountFields).toMatchObject({
      siblingDiscountWaived: true,
      siblingDiscountWaivedReason: 'Phu huynh tu choi',
    });
    expect(result.discountFields).not.toHaveProperty('siblingDiscount');
  });

  it('rejects a waiver with a blank reason', () => {
    expect(() =>
      run({ ...eligibleDefaults, siblingWaived: true, siblingWaivedReason: '   ' })
    ).toThrow('A reason is required to waive the sibling scholarship');
  });

  it('writes no sibling field on a full waiver even when eligible', () => {
    const result = run({
      ...eligibleDefaults,
      siblingClaimed: true,
      discountType: 'full_waiver',
      amountReceived: 0,
    });
    expect(result.siblingGrant).toBe(0);
    expect(result.discountFields).not.toHaveProperty('siblingDiscount');
    expect(result.discountFields).not.toHaveProperty('siblingDiscountWaived');
  });

  it('errors when the grant pushes the balance below what was received', () => {
    expect(() => run({ ...eligibleDefaults, amountReceived: 1_000_000 })).toThrow(
      'Amount exceeds remaining tuition'
    );
  });
});
