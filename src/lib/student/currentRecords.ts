/**
 * Student identity/de-duplication rules live in `shared/studentRecords` so the
 * API and the client compute "current students" from a single implementation.
 * This module is kept as the client-facing entry point.
 */
export {
  countCurrentStudents,
  getCurrentClassStudentRecords,
  getCurrentStudentHeadcount,
  getCurrentStudentRecords,
  getCurrentStudentRoster,
  getStudentIdentityKey,
  selectEnrolledStudentRows,
  isHistoricalPromotedStudentRecord,
  type StudentIdentityRecord,
} from '../../../shared/studentRecords';
