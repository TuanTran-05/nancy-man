// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClassFormModal } from './ClassFormModal';

vi.mock('../../../components/common/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const baseTranslations = {
  en: {
    common: { cancel: 'Cancel' },
    classesPage: { sessions: 'sessions', saving: 'Saving', importing: 'Importing' },
  },
};

const baseT = {
  editClass: 'Edit Class',
  classNameLabel: 'Class name',
  classNamePlaceholder: 'Class name',
  gradeLabel: 'Grade',
  selectGrade: 'Select grade',
  gradeOption: 'Grade {grade}',
  teacherLabel: 'Teacher',
  selectTeacher: 'Select teacher',
  salaryLabel: 'Salary / Session (VND)',
  salaryPlaceholder: 'Salary',
  tuitionFeeLabel: 'Course Tuition Fee (VND)',
  tuitionFeePlaceholder: 'Tuition',
  importStudentsTitle: 'Import students',
  importStudentsDesc: 'Import students',
  selectSourceClass: 'Select source class',
  importNote: 'Import note',
  statusOnlyMsg: 'Status only',
  classStatus: 'Class status',
  filterActive: 'Active',
  filterPaused: 'Paused',
  filterArchived: 'Archived',
  startDate: 'Start date',
  endDate: 'End date',
  scheduleWeek: 'Schedule week',
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  scheduleText: 'Schedule',
  schedulePlaceholder: 'Schedule',
  startTime: 'Start time',
  roomLabel: 'Room',
  roomPlaceholder: 'Room',
  descLabel: 'Description',
  descPlaceholder: 'Description',
  saveChanges: 'Save changes',
  createClass: 'Create class',
  weeklySessionsTitle: 'Weekly sessions',
  addWeeklySession: 'Add session',
  removeWeeklySession: 'Remove session',
  sessionDay: 'Day',
  sessionStartTime: 'Start',
  sessionEndTime: 'End',
  sessionRoom: 'Room override',
};

const baseFormData = {
  name: 'E101',
  schedule: '',
  daysOfWeek: [],
  description: '',
  startDate: '',
  endDate: '',
  startTime: '',
  room: '',
  teacherId: 'teacher-1',
  status: 'active',
  salaryPerSession: 500000,
  tuitionFee: 3000000,
  grade: '',
  weeklySessions: [],
};

describe('ClassFormModal', () => {
  it('shows salary and tuition inputs for office class setup access', () => {
    render(
      <ClassFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingClass={null}
        formData={baseFormData}
        setFormData={vi.fn()}
        teachers={[{ uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@example.com' }]}
        sourceClasses={[]}
        importSourceClassId=""
        setImportSourceClassId={vi.fn()}
        hasFullAcademicAccess={true}
        canManageClassFinance={true}
        classTeacherLookup={[]}
        isSaving={false}
        isImporting={false}
        language="en"
        t={baseT}
        translations={baseTranslations}
        handleSubmit={vi.fn()}
      />
    );

    expect(screen.getByText('Salary / Session (VND)')).toBeInTheDocument();
    expect(screen.getByText('Course Tuition Fee (VND)')).toBeInTheDocument();
  });

  it('blurs salary and tuition inputs on wheel without changing form data', () => {
    const setFormData = vi.fn();
    render(
      <ClassFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingClass={null}
        formData={baseFormData}
        setFormData={setFormData}
        teachers={[{ uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@example.com' }]}
        sourceClasses={[]}
        importSourceClassId=""
        setImportSourceClassId={vi.fn()}
        hasFullAcademicAccess={true}
        canManageClassFinance={true}
        classTeacherLookup={[]}
        isSaving={false}
        isImporting={false}
        language="en"
        t={baseT}
        translations={baseTranslations}
        handleSubmit={vi.fn()}
      />
    );

    const salaryInput = screen.getByPlaceholderText('Salary');
    const tuitionInput = screen.getByPlaceholderText('Tuition');

    salaryInput.focus();
    expect(salaryInput).toHaveFocus();
    fireEvent.wheel(salaryInput);
    expect(salaryInput).not.toHaveFocus();

    tuitionInput.focus();
    expect(tuitionInput).toHaveFocus();
    fireEvent.wheel(tuitionInput);
    expect(tuitionInput).not.toHaveFocus();

    expect(setFormData).not.toHaveBeenCalled();
  });

  it('edits multiple weekly session rows', async () => {
    const user = userEvent.setup();
    const setFormData = vi.fn();
    render(
      <ClassFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingClass={null}
        formData={{
          ...baseFormData,
          weeklySessions: [{ dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' }],
        }}
        setFormData={setFormData}
        teachers={[{ uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@example.com' }]}
        sourceClasses={[]}
        importSourceClassId=""
        setImportSourceClassId={vi.fn()}
        hasFullAcademicAccess={true}
        canManageClassFinance={true}
        classTeacherLookup={[]}
        isSaving={false}
        isImporting={false}
        language="en"
        t={baseT}
        translations={baseTranslations}
        handleSubmit={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklySessions: [
          { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
          { dayOfWeek: 0, startTime: '', endTime: '', room: '' },
        ],
      })
    );
  });
});
