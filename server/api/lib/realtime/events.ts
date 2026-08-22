import { FieldValue } from '@/server/db/documentStore.js';
import { getDb } from '../auth/verifyAuth.js';

export type RealtimeEventKey =
  | 'students'
  | 'finance-ledger'
  | 'finance-receipt'
  | 'finance-expense'
  | 'parent-tuition'
  | 'parent-dashboard'
  | 'admin-summary'
  | 'admissions'
  | 'accounting-students'
  | 'accounting-student-finance'
  | 'knowledge-bank'
  | 'assignments'
  | 'submissions'
  | 'teacher-attendance'
  | 'teacher-availability'
  | 'payroll'
  | 'course-closing'
  | 'print-requests'
  | 'office-schedule-changed'
  | 'office-academic-changed';

export interface TouchRealtimeEventOptions {
  targetId?: string | null;
  roleScope?: string[];
}

const DEFAULT_REALTIME_EVENT_ROLE_SCOPE: Record<RealtimeEventKey, string[]> = {
  students: ['admin', 'teacher', 'office', 'accounting'],
  'finance-ledger': ['admin', 'accounting'],
  'finance-receipt': ['admin', 'accounting'],
  'finance-expense': ['admin', 'accounting'],
  'parent-tuition': ['admin', 'parent', 'student'],
  'parent-dashboard': ['admin', 'parent', 'student'],
  'admin-summary': ['admin'],
  admissions: ['admin', 'office'],
  'accounting-students': ['admin', 'accounting'],
  'accounting-student-finance': ['admin', 'accounting'],
  'knowledge-bank': ['admin', 'teacher', 'office', 'accounting'],
  assignments: ['admin', 'teacher', 'student', 'parent'],
  submissions: ['admin', 'teacher', 'student', 'parent'],
  'teacher-attendance': ['admin', 'office'],
  'teacher-availability': ['admin', 'teacher', 'office'],
  payroll: ['admin', 'teacher', 'accounting'],
  'course-closing': ['admin', 'teacher', 'office', 'accounting'],
  'print-requests': ['admin', 'teacher', 'office'],
  'office-schedule-changed': ['admin', 'office'],
  'office-academic-changed': ['admin', 'office'],
};

export async function touchRealtimeEvent(
  key: RealtimeEventKey,
  options?: TouchRealtimeEventOptions
): Promise<void> {
  try {
    const db = getDb();
    const docRef = db.collection('realtime_events').doc(key);

    const updateData: Record<string, any> = {
      key,
      version: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      targetId: options?.targetId ?? null,
    };

    if (options?.roleScope !== undefined) {
      updateData.roleScope = options.roleScope;
    }

    await docRef.set(updateData, { merge: true });
  } catch (err) {
    console.error(`[touchRealtimeEvent] failed to touch event key ${key}:`, err);
  }
}
