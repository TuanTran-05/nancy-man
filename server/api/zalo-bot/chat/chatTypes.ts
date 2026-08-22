export const ZALO_BOT_CHAT_INTENTS = [
  'class_student_count',
  'class_student_list',
  'class_end_date',
  'attendance_today',
  'my_todo',
  'unsupported',
] as const;

export type ZaloBotChatIntent = (typeof ZALO_BOT_CHAT_INTENTS)[number];

export type ZaloBotChatQuestion = {
  intent: ZaloBotChatIntent;
  classNameHint: string | null;
};

export type ZaloBotChatAnswer =
  | {
      kind: 'student_count';
      className: string;
      active: number;
      onLeave: number;
      trial: number;
    }
  | { kind: 'student_list'; className: string; names: string[]; omitted: number }
  | { kind: 'class_end_date'; className: string; endDate: string | null }
  | {
      kind: 'attendance_today';
      date: string;
      classes: Array<{ className: string; eligible: number; marked: number; missing: number }>;
    }
  | {
      kind: 'my_todo';
      attendance: Array<{ className: string; missingStudentCount: number }>;
      courseClosing: Array<{ className: string; endDate: string }>;
      printRequests: Array<{
        className: string;
        teacherName: string;
        neededDate: string;
        fileCount: number;
        totalCopies: number;
      }>;
    }
  | { kind: 'class_not_found'; hint: string }
  | { kind: 'class_ambiguous'; candidates: string[] }
  | { kind: 'unsupported' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };
