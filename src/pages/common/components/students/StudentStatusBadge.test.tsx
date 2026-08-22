// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudentStatusBadge } from './StudentStatusBadge';

const t = {
  filterActive: 'Đang học',
  filterOnLeave: 'Bảo lưu',
  filterDropped: 'Đã nghỉ',
};

function renderBadge(student: Record<string, unknown>) {
  return render(
    <StudentStatusBadge
      student={student as never}
      t={t}
      waitingPromotionStatusLabel="Chờ xếp lớp"
    />
  );
}

describe('StudentStatusBadge', () => {
  it('labels a finished student "Chờ xếp lớp" even while the profile still says active', () => {
    // The profile's `enrollmentStatus` is a projection nothing rewrote when
    // the course closed. Rendering it shows a student as attending a course
    // that ended.
    renderBadge({
      studentLifecycle: 'enrolled',
      enrollmentStatus: 'active',
      placementStatus: 'waiting_for_placement',
    });

    expect(screen.getByText('Chờ xếp lớp')).toBeTruthy();
  });

  it('labels a studying student active even while the profile still says promoted', () => {
    renderBadge({
      studentLifecycle: 'enrolled',
      enrollmentStatus: 'promoted',
      placementStatus: 'studying',
    });

    expect(screen.getByText('Đang học')).toBeTruthy();
  });

  it('shows on leave from the enrollment', () => {
    renderBadge({ studentLifecycle: 'enrolled', placementStatus: 'on_leave' });
    expect(screen.getByText('Bảo lưu')).toBeTruthy();
  });

  it('shows the trial badge for a trial placement', () => {
    renderBadge({ studentLifecycle: 'trial', placementStatus: 'trial' });
    expect(screen.getByText('Trial')).toBeTruthy();
  });

  it('falls back to the profile status for a response written before the rollout', () => {
    renderBadge({ studentLifecycle: 'enrolled', enrollmentStatus: 'on_leave' });
    expect(screen.getByText('Bảo lưu')).toBeTruthy();
  });

  it('keeps the archived badge, which is a lifecycle fact rather than a placement', () => {
    renderBadge({ studentLifecycle: 'archived', placementStatus: 'inactive' });
    expect(screen.getByText('Archived')).toBeTruthy();
  });
});
