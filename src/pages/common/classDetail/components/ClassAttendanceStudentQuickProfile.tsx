import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { Class, Student, UserProfile } from '../../../../types';
import { useLanguage } from '../../../../lib/i18n/useLanguage';
import { translations } from '../../../../lib/i18n/translations';
import { useAttendanceStudentQuickProfile } from '../../../../hooks/useAttendanceStudentQuickProfile';
import { AttendanceStudentQuickProfilePanel } from '../../../../components/classDetail/AttendanceStudentQuickProfilePanel';
import { useStudentActionModals } from '../../components/students/StudentActionModals';
import { loadStudentEditReferenceData } from '../../../../lib/student/studentActionReferenceData';
import { coerceSafeStudent } from '../../../../lib/student/useStudentProfileData';

type Props = {
  profile: UserProfile | null;
  classData: Class;
  student: Student | null;
  isArchived: boolean;
  isPaused: boolean;
  refreshStudents: () => Promise<void>;
  onClose: () => void;
};

export const ClassAttendanceStudentQuickProfile: React.FC<Props> = ({
  profile,
  classData,
  student,
  isArchived,
  isPaused,
  refreshStudents,
  onClose,
}) => {
  const { language } = useLanguage();
  const [preparingEdit, setPreparingEdit] = useState(false);

  const quickProfile = useAttendanceStudentQuickProfile({
    studentId: student?.id || '',
    classId: classData.id,
    enabled: student !== null,
  });

  const classOptions = useMemo(() => [classData], [classData]);
  const readOnly = isArchived || isPaused;

  const handleChanged = () => {
    void Promise.allSettled([refreshStudents(), quickProfile.reload()]);
  };

  const studentActions = useStudentActionModals({
    classes: classOptions,
    sortedClasses: classOptions,
    filterableClasses: readOnly ? [] : classOptions,
    teachers: [],
    resolveFaceSrc: (row) => row.faceImage || '',
    loadEditReferences: () =>
      loadStudentEditReferenceData({ role: profile?.role, currentClass: classData }),
    onChanged: handleChanged,
    t: translations[language].students,
    tc: translations[language].common,
  });

  if (!student) return null;

  const quickLabels = translations[language].classAttendanceTab.quickProfile;

  const handleEdit = async () => {
    const rawStudent = quickProfile.data?.student || student;
    const safeStudent = coerceSafeStudent(rawStudent as unknown as Record<string, unknown>);
    setPreparingEdit(true);
    try {
      await studentActions.controller.openEdit(safeStudent);
    } catch {
      toast.error(quickLabels.editLoadError);
    } finally {
      setPreparingEdit(false);
    }
  };

  const handleChangeStatus = () => {
    const rawStudent = quickProfile.data?.student || student;
    const safeStudent = coerceSafeStudent(rawStudent as unknown as Record<string, unknown>);
    studentActions.controller.openStatus(safeStudent);
  };

  return (
    <>
      <AttendanceStudentQuickProfilePanel
        open={Boolean(student)}
        student={student}
        data={quickProfile.data}
        loading={quickProfile.loading}
        error={quickProfile.error}
        readOnly={readOnly}
        canViewFinance={profile?.role === 'admin'}
        preparingEdit={preparingEdit}
        labels={quickLabels}
        onClose={onClose}
        onRetry={quickProfile.reload}
        onEdit={handleEdit}
        onChangeStatus={handleChangeStatus}
      />
      {studentActions.modals}
    </>
  );
};
