import { Navigate, useParams } from 'react-router';
import { isGlobalSuccessGrade } from '../../data/global-success';
import type { UserProfile } from '../../types';

interface KnowledgeBankUnitProps {
  profile?: UserProfile | null;
}

const parseGradeSlug = (gradeSlug?: string) => {
  const grade = Number((gradeSlug || '').replace('grade-', ''));
  return isGlobalSuccessGrade(grade) ? grade : null;
};

const parseUnitSlug = (unitSlug?: string) => {
  const unit = Number((unitSlug || '').replace('unit-', ''));
  return Number.isInteger(unit) && unit >= 1 && unit <= 12 ? unit : null;
};

export default function KnowledgeBankUnit(_props: KnowledgeBankUnitProps) {
  const { gradeSlug, unitSlug } = useParams();
  const grade = parseGradeSlug(gradeSlug);
  const unitNumber = parseUnitSlug(unitSlug);

  if (!grade || !unitNumber) {
    return <Navigate to="/knowledge-bank" replace />;
  }

  return (
    <Navigate to={`/knowledge-bank/global-success/grade-${grade}?unit=${unitNumber}`} replace />
  );
}
