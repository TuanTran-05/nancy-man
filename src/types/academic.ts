export interface Attendance {
  id: string;
  classId: string;
  studentId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  status: 'present' | 'absent' | 'late';
  permission?: boolean; // For absent
  minutesLate?: number; // For late
  teacherId: string;
  updatedAt: string | { seconds: number; nanoseconds: number };
}

import type { EvaluationRank } from '../../shared/evaluationRank';
import type { AssignmentProctoringMode } from '../../shared/assignmentProctoring';
import type {
  AssessmentAnswer,
  AssessmentScore,
  AssignmentAssessment,
} from '../../shared/assignmentAssessment';

export interface Evaluation {
  id: string;
  studentId: string;
  classId: string;
  teacherId: string;
  evaluationType: 'midterm' | 'final';
  scores: {
    attendance: number;
    effort: number;
    pronunciation: number;
    homework: number;
    behavior: number;
  };
  totalScore: number;
  finalScore?: number; // Final exam score
  rank?: EvaluationRank;
  positivePoints: string[];
  improvementPoints: string;
  aiFeedback?: string; // AI generated feedback
  date: string;
  termId?: string;
  termStart?: string;
  termEnd?: string;
  createdAt: string;
  updatedAt?: string | { seconds: number; nanoseconds: number };
}

export interface DailyReport {
  id: string;
  classId: string;
  teacherId: string;
  date: string; // YYYY-MM-DD
  generalComment: string;
  additionalNotes: string;
  updatedAt: string | { seconds: number; nanoseconds: number };
}

export interface QuizOption {
  key: string; // A, B, C, D
  text: string;
}

export interface QuizQuestion {
  id: number;
  question_content: string;
  options: QuizOption[];
  correct_answer: string; // A, B, C, D
  level: string;
}

import type { AssignmentDeliveryPolicy } from '../../shared/assignmentDelivery';

export interface Assignment {
  id: string;
  title: string;
  description: string;
  dueDate: string; // ISO date-time string
  classId: string;
  teacherId: string;
  createdAt: string;
  type: 'essay' | 'quiz';
  questions?: QuizQuestion[];
  attemptsAllowed?: number; // Default to 1 if not specified
  proctoringMode?: AssignmentProctoringMode;
  assessment?: AssignmentAssessment;
  deliveryPolicy?: AssignmentDeliveryPolicy;
}

export interface QuizAnswer {
  questionId: number;
  selectedOption: string; // A, B, C, D
}

export type ExamAutoSubmitReason = 'tab_focus_limit' | 'fullscreen_exit_limit';

export interface ExamMetrics {
  tabSwitchCount: number;
  focusLossCount: number;
  fullscreenExitCount: number;
  sessionStartedAt: string | null;
}

export interface ExamIntegrityPayload {
  tabSwitchCount: number;
  focusLossCount: number;
  fullscreenExitCount: number;
  sessionStartedAt: string | null;
  autoSubmitted?: boolean;
  autoSubmitReason?: ExamAutoSubmitReason;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName?: string;
  teacherId: string;
  classId: string;
  content: string;
  quizAnswers?: QuizAnswer[];
  assessmentAnswers?: AssessmentAnswer[];
  assessmentScore?: AssessmentScore;
  status: 'submitted' | 'graded';
  grade?: number;
  feedback?: string;
  submittedAt: string;
  attemptNumber?: number;
  examIntegrity?: ExamIntegrityPayload;
}

export interface KnowledgeBankItem {
  id: string;
  title: string;
  description?: string;
  targetType?: 'class' | 'grade' | 'program';
  grade?: number;
  programName?: string;
  classId?: string;
  className?: string;
  uploadedBy: string;
  uploadedByName: string;
  originalFilename: string;
  fileType: 'pdf' | 'docx';
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
  updatedAt?: string;
  downloadCount?: number;
  lastDownloadedAt?: string;
  curriculumFamily?: 'global-success';
  unitNumber?: number | null;
  resourceKind?: 'document';
}

export type LessonSlideLayout =
  | 'cover'
  | 'objectives'
  | 'outline'
  | 'section-cover'
  | 'title-content'
  | 'image-text'
  | 'audio-text'
  | 'cards'
  | 'explain'
  | 'practice';

export type LessonSlideAccent = 'blue' | 'pink' | 'orange' | 'green' | 'purple' | 'red';

export interface LessonTextRun {
  text: string;
  accent?: LessonSlideAccent;
  bold?: boolean;
  italic?: boolean;
}

export type LessonRichText = string | LessonTextRun[];

export interface LessonSlideBullet {
  content: LessonRichText;
}

export interface LessonSlideCard {
  title: string;
  subtitle?: string;
  content?: LessonRichText;
  bullets?: LessonRichText[];
  example?: string;
  accent?: LessonSlideAccent;
}

export interface LessonSlideSection {
  title: string;
  subtitle?: string;
  content?: LessonRichText;
  bullets?: LessonRichText[];
  example?: string;
  accent?: LessonSlideAccent;
}

export interface LessonSlide {
  id: string;
  title: string;
  layout: LessonSlideLayout;
  label?: string;
  subtitle?: string;
  accent?: LessonSlideAccent;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  bullets?: LessonSlideBullet[];
  cards?: LessonSlideCard[];
  sections?: LessonSlideSection[];
  examples?: string[];
  formula?: string;
  footerNote?: string;
}

export interface LessonDeck {
  id: string;
  curriculumFamily: 'global-success';
  grade: 6 | 7 | 8 | 9;
  unitNumber: number;
  title: string;
  description?: string;
  slides: LessonSlide[];
  createdAt: string;
  updatedAt?: string;
}
