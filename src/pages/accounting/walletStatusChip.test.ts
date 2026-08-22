import { describe, expect, it } from 'vitest';
import { walletStatusChip } from './components/WalletTab';

/**
 * The chip beside a balance tells an accountant whether the money is owed by
 * somebody still attending. Derived from the profile it was often wrong in
 * exactly the case that matters: a student whose course closed still reads
 * `enrollmentStatus: 'active'` there, so a debt nobody was chasing looked
 * like an ordinary current one.
 */
describe('walletStatusChip', () => {
  it('flags a student waiting for placement even while the profile says active', () => {
    expect(
      walletStatusChip({
        enrollmentStatus: 'active',
        placementStatus: 'waiting_for_placement',
      } as never)
    ).toMatchObject({ label: 'Chờ lên lớp' });
  });

  it('shows no chip for a student the enrollment says is studying', () => {
    // The profile still says `promoted` because nothing rewrote it when the
    // next course began.
    expect(
      walletStatusChip({ enrollmentStatus: 'promoted', placementStatus: 'studying' } as never)
    ).toBeNull();
  });

  it('flags on leave from the enrollment', () => {
    expect(walletStatusChip({ placementStatus: 'on_leave' } as never)).toMatchObject({
      label: 'Bảo lưu',
    });
  });

  it('keeps the trial chip, which is a lifecycle fact', () => {
    expect(
      walletStatusChip({ studentLifecycle: 'trial', placementStatus: 'trial' } as never)
    ).toMatchObject({ label: 'Học thử' });
  });

  it('keeps the archived chip ahead of any placement', () => {
    expect(
      walletStatusChip({ isRevoked: true, placementStatus: 'studying' } as never)
    ).toMatchObject({ label: 'Đã nghỉ' });
  });

  it('falls back to the profile status for a response written before the rollout', () => {
    expect(walletStatusChip({ enrollmentStatus: 'on_leave' } as never)).toMatchObject({
      label: 'Bảo lưu',
    });
  });
});
