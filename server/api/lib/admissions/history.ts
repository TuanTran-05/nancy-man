import type { DocumentStore } from '@/server/db/documentStore.js';

export type AdmissionHistoryAction =
  | 'created_trial'
  | 'reactivated_trial'
  | 'possible_match_selected'
  | 'added_to_waitlist'
  | 'deleted_from_waitlist'
  | 'class_assigned'
  | 'class_changed'
  | 'teacher_review_ready'
  | 'teacher_accepted'
  | 'teacher_rejected'
  | 'archived';

export async function appendAdmissionHistory(
  db: DocumentStore,
  entry: {
    studentId: string;
    action: AdmissionHistoryAction;
    actorId: string;
    actorRole: string;
    classId?: string;
    teacherId?: string;
    trialSessionCount?: number;
    note?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await db.collection('admissions_history').add({
    ...entry,
    timestamp: new Date().toISOString(),
  });
}
