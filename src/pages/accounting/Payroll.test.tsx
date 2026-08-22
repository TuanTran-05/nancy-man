// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Payroll from './Payroll';

type TeacherPayrollMockProps = {
  teacherId?: string;
  canEditSalary?: boolean;
};

const teacherPayrollMock = vi.hoisted(() =>
  vi.fn((props: TeacherPayrollMockProps) => <div>Teacher payroll</div>)
);

vi.mock('../../components/finance/TeacherPayroll', () => ({
  TeacherPayroll: (props: any) => teacherPayrollMock(props),
}));

describe('Accounting Payroll page', () => {
  it('renders all-teacher payroll without salary editing controls', () => {
    render(<Payroll />);

    expect(teacherPayrollMock.mock.calls[0][0]).toMatchObject({ canEditSalary: false });
    expect(teacherPayrollMock.mock.calls[0][0]).not.toHaveProperty('teacherId');
  });
});
