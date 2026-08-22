// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SafeStudent } from '../../../types';
import { StudentOverviewTab } from './StudentOverviewTab';

const student: SafeStudent = {
  id: 'student-1',
  name: 'Anh Thu',
  studentId: 'HS260224',
  dob: '2012-08-06',
  contact: '0345647924',
  classId: 'class-1',
  teacherId: 'teacher-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  code: 'AT01',
  gender: 'female',
  enrollmentStatus: 'active',
  studentLifecycle: 'enrolled',
  enrollmentDate: '2026-02-03T04:05:06.000Z',
};

const t = {
  modal: {
    dobLabel: 'Ngày sinh',
    enrollmentDateLabel: 'Ngày nhập học',
    enrollmentDateHelp: 'x',
    notEnrolled: 'Chưa nhập học',
    enrollmentDateUnknown: 'Chưa xác định',
    classLabel: 'Lớp học',
    contactLabel: 'Liên hệ',
  },
  genderLabel: 'Giới tính',
  male: 'Nam',
  female: 'Nữ',
  other: 'Khác',
  messages: {
    parentLoggedIn: 'Đã đăng nhập',
    parentNotLoggedIn: 'Chưa đăng nhập',
  },
  lastAccess: 'Truy cập cuối',
};

describe('StudentOverviewTab', () => {
  it('renders class label, enrollment date, and known parent-not-logged-in (null)', () => {
    render(
      <StudentOverviewTab
        student={student}
        classLabel="Advanced 9 - Mrs. Hương"
        parentLoginInfo={null}
        language="vi"
        t={t}
        siblings={[]}
        siblingCandidates={[]}
        canEditSiblings={false}
        onSiblingsChanged={() => {}}
      />
    );

    expect(screen.getByText('Advanced 9 - Mrs. Hương')).toBeInTheDocument();
    expect(screen.getByText('03/02/2026')).toBeInTheDocument();
    expect(screen.getByText('Chưa đăng nhập')).toBeInTheDocument();
  });

  it('reads a DocumentStore timestamp last access instead of crashing the profile', () => {
    render(
      <StudentOverviewTab
        student={student}
        classLabel="Advanced 9"
        parentLoginInfo={{ updatedAt: { seconds: 1783694596, nanoseconds: 286_000_000 } }}
        language="vi"
        t={t}
        siblings={[]}
        siblingCandidates={[]}
        canEditSiblings={false}
        onSiblingsChanged={() => {}}
      />
    );

    expect(screen.getByText(/Đã đăng nhập/)).toBeInTheDocument();
    expect(screen.getByText(/Truy cập cuối/)).toBeInTheDocument();
  });

  it('keeps the logged-in line without a last access when the timestamp is unreadable', () => {
    render(
      <StudentOverviewTab
        student={student}
        classLabel="Advanced 9"
        parentLoginInfo={{ updatedAt: 'not-a-date' }}
        language="vi"
        t={t}
        siblings={[]}
        siblingCandidates={[]}
        canEditSiblings={false}
        onSiblingsChanged={() => {}}
      />
    );

    expect(screen.getByText('Đã đăng nhập')).toBeInTheDocument();
    expect(screen.queryByText(/Truy cập cuối/)).not.toBeInTheDocument();
  });

  it('hides the parent-login box entirely when info is unknown (undefined)', () => {
    render(
      <StudentOverviewTab
        student={student}
        classLabel="Advanced 9"
        parentLoginInfo={undefined}
        language="vi"
        t={t}
        siblings={[]}
        siblingCandidates={[]}
        canEditSiblings={false}
        onSiblingsChanged={() => {}}
      />
    );

    expect(screen.queryByText('Chưa đăng nhập')).not.toBeInTheDocument();
    expect(screen.queryByText('Đã đăng nhập', { exact: false })).not.toBeInTheDocument();
  });
});
