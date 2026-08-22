export interface Notification {
  id: string;
  studentId: string;
  title: string;
  message: string;
  type: 'absence' | 'missing_assignment' | 'general';
  isRead: boolean;
  createdAt: string;
  teacherId?: string;
  classId?: string;
  templateKey?: import('./student').QuickNotifyTemplateKey;
  contextDate?: string;
}
