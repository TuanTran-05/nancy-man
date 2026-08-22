import {
  computeSiblingGrant,
  describeSiblingEligibility,
  type SiblingEligibility,
  type SiblingStudentRecord,
} from '../../../shared/siblingScholarship';

export type ReceiptSiblingView = 'ineligible' | 'available' | 'already_granted' | 'full_waiver';

export type ReceiptSiblingState = {
  eligibility: SiblingEligibility;
  availableSiblingGrant: number;
  siblingGrant: number;
  view: ReceiptSiblingView;
};

/**
 * Derives everything the receipt modal needs to render and price the sibling
 * scholarship. `availableSiblingGrant` ignores the waiver so checking it never
 * hides its own panel; `siblingGrant` is what actually gets sent.
 */
export function deriveReceiptSiblingState(args: {
  student: SiblingStudentRecord | undefined;
  pool: readonly SiblingStudentRecord[];
  ledgerAmount: number;
  siblingDiscountTotal: number;
  discountType: string;
  siblingWaived: boolean;
}): ReceiptSiblingState {
  const isFullWaiver = args.discountType === 'full_waiver';
  const eligibility = args.student
    ? describeSiblingEligibility(args.student, args.pool)
    : { eligible: false, reason: 'no_group' as const, activeCount: 0 };

  const availableSiblingGrant = computeSiblingGrant({
    ledgerAmount: args.ledgerAmount,
    siblingDiscountTotal: args.siblingDiscountTotal,
    eligible: eligibility.eligible,
    waived: false,
    isFullWaiver: false,
  });

  const siblingGrant = args.siblingWaived || isFullWaiver ? 0 : availableSiblingGrant;

  const view: ReceiptSiblingView = isFullWaiver
    ? 'full_waiver'
    : !eligibility.eligible
      ? 'ineligible'
      : availableSiblingGrant <= 0
        ? 'already_granted'
        : 'available';

  return { eligibility, availableSiblingGrant, siblingGrant, view };
}
