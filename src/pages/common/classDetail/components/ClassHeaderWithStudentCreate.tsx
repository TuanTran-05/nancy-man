import React from 'react';
import { useLanguage } from '../../../../lib/i18n/useLanguage';
import { translations } from '../../../../lib/i18n/translations';
import { useBodyScrollLock } from '../../../../hooks/useBodyScrollLock';
import { useStudentActionModals } from '../../components/students/StudentActionModals';
import { ClassHeader } from './ClassHeader';

type Props = Omit<React.ComponentProps<typeof ClassHeader>, 'onAddStudent'> & {
  onStudentsChanged: () => void;
};

export function ClassHeaderWithStudentCreate({ onStudentsChanged, ...headerProps }: Props) {
  const { language } = useLanguage();
  const studentText = translations[language].students;
  const commonText = translations[language].common;
  const classOptions = React.useMemo(() => [headerProps.classData], [headerProps.classData]);
  const { controller, modals, isAnyOpen } = useStudentActionModals({
    classes: classOptions,
    sortedClasses: classOptions,
    filterableClasses: headerProps.isArchived ? [] : classOptions,
    teachers: [],
    resolveFaceSrc: (student) => student.faceImage || '',
    onChanged: onStudentsChanged,
    t: studentText,
    tc: commonText,
  });

  useBodyScrollLock(isAnyOpen);

  return (
    <>
      <ClassHeader
        {...headerProps}
        onAddStudent={() =>
          controller.openCreate({ classId: headerProps.classData.id, fixedClass: true })
        }
      />
      {modals}
    </>
  );
}
