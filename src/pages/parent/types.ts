import type React from 'react';
import type { Attendance } from '../../types';

export type OverviewCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  trend?: number | null;
  color: 'blue' | 'orange' | 'emerald' | 'violet';
};

export type ProgressMetricBarProps = {
  label: string;
  studentValue: number;
  classAverage: number | null;
  suffix?: string;
};

export type RecentAssignmentItem = {
  id: string;
  title: string;
  dueDate: string;
  statusLabel: string;
  statusTone: 'green' | 'orange' | 'red';
  gradeLabel: string;
};

export type TeacherCommentItem = {
  id: string;
  title: string;
  text: string;
  date: string;
};

export type WarningAlertItem = {
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  description: string;
};

export type HeatmapCell = {
  date: Date;
  iso: string;
  status: Attendance['status'] | 'empty';
  label: string;
};
