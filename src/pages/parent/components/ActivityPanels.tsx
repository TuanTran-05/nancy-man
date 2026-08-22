import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MessageSquare,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/core/utils';
import type { RecentAssignmentItem, TeacherCommentItem, WarningAlertItem } from '../types';
import { SectionCard } from './CommonWidgets';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function WarningAlerts({
  alerts,
  onDismiss,
}: {
  language?: 'vi' | 'en';
  alerts: WarningAlertItem[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={AlertTriangle}
      title={t.parent.warningAlerts}
      subtitle={t.parent.priorityItems}
    >
      {alerts.length ? (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn(
                'flex items-start justify-between gap-3 rounded-2xl border px-4 py-3',
                alert.tone === 'danger'
                  ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-500/10'
                  : 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/10'
              )}
            >
              <div className="flex gap-3">
                <div
                  className={cn(
                    'mt-0.5 rounded-xl p-2',
                    alert.tone === 'danger'
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                  )}
                >
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <p
                    className={cn(
                      'text-sm font-bold',
                      alert.tone === 'danger'
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {alert.title}
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-sm leading-6',
                      alert.tone === 'danger'
                        ? 'text-red-600 dark:text-red-300'
                        : 'text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {alert.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(alert.id)}
                className="rounded-full p-1 text-slate-400 transition hover:bg-black/5 dark:hover:bg-white/10 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label={t.parent.dismissAlert}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700 dark:text-emerald-400">
          {t.parent.noWarnings}
        </div>
      )}
    </SectionCard>
  );
}

export function TeacherComments({
  comments,
  expandedComments,
  onToggleExpand,
  formatDateLabel,
}: {
  language?: 'vi' | 'en';
  comments: TeacherCommentItem[];
  expandedComments: string[];
  onToggleExpand: (id: string) => void;
  formatDateLabel: (value?: string | number | Date | null, pattern?: string) => string;
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={MessageSquare}
      title={t.parent.teacherComments}
      subtitle={t.parent.latestComments}
    >
      {comments.length ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {comments.map((comment) => {
            const isExpanded = expandedComments.includes(comment.id);
            return (
              <div
                key={comment.id}
                className="min-w-[280px] max-w-[320px] flex-1 rounded-[24px] border border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-sm font-bold text-blue-700 dark:text-blue-400">
                    GV
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {comment.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateLabel(comment.date)}
                    </p>
                  </div>
                </div>

                <p
                  className={cn(
                    'mt-4 text-sm leading-7 text-slate-700 dark:text-slate-300',
                    !isExpanded && 'line-clamp-4'
                  )}
                >
                  {comment.text}
                </p>

                {comment.text.length > 120 ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(comment.id)}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 transition hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    {isExpanded ? t.parent.showLess : t.parent.readMore}
                    <ChevronRight
                      className={cn('w-3.5 h-3.5 transition', isExpanded && 'rotate-90')}
                    />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-100 dark:border-slate-700 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t.parent.noComments}
        </div>
      )}
    </SectionCard>
  );
}

export function ActionPlan({
  plans,
  checkedPlanIds,
  onTogglePlan,
}: {
  language?: 'vi' | 'en';
  plans: Array<{ id: string; label: string }>;
  checkedPlanIds: string[];
  onTogglePlan: (id: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={CheckCircle2}
      title={t.parent.nextActionPlan}
      subtitle={t.parent.checklistSubtitle}
    >
      <div className="space-y-3">
        {plans.map((plan) => {
          const checked = checkedPlanIds.includes(plan.id);
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onTogglePlan(plan.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                checked
                  ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-500/10'
                  : 'border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/50 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/50 dark:hover:bg-blue-500/5'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 transition',
                  checked
                    ? 'border-blue-600 dark:border-blue-500 bg-blue-600 dark:bg-blue-500 text-white'
                    : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-transparent'
                )}
              >
                <Check className="w-4 h-4" />
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  checked
                    ? 'text-blue-800 dark:text-blue-300 line-through'
                    : 'text-slate-700 dark:text-slate-200'
                )}
              >
                {plan.label}
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function SemesterTimeline({
  timelineItems,
}: {
  language?: 'vi' | 'en';
  timelineItems: Array<{
    id: string;
    name: string;
    dateLabel: string;
    badge: string;
    active: boolean;
  }>;
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={Clock3}
      title={t.parent.courseTimeline}
      subtitle={t.parent.courseHistoryTimeline}
    >
      <div className="relative space-y-5 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-18px)] before:w-px before:bg-slate-200 dark:before:bg-slate-700/60">
        {timelineItems.map((item) => (
          <div key={item.id} className="relative pl-9">
            <div
              className={cn(
                'absolute left-0 top-1.5 h-6 w-6 rounded-full border-4 border-white dark:border-slate-800',
                item.active
                  ? 'bg-blue-600 shadow-[0_0_0_6px_rgba(59,130,246,0.14)] dark:shadow-[0_0_0_6px_rgba(59,130,246,0.1)]'
                  : 'bg-slate-300 dark:bg-slate-600'
              )}
            />
            <div className="rounded-[22px] border border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p
                    className={cn(
                      'text-sm font-bold',
                      item.active
                        ? 'text-blue-700 dark:text-blue-400'
                        : 'text-slate-700 dark:text-slate-200'
                    )}
                  >
                    {item.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {item.dateLabel}
                  </p>
                </div>
                {item.active ? (
                  <span className="rounded-full bg-blue-50 dark:bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                    {t.parent.currentBadge}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 inline-flex rounded-full bg-orange-50 dark:bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-700 dark:text-orange-400">
                {item.badge}
              </p>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function RecentHomeworkList({
  items,
  formatDateLabel,
}: {
  language?: 'vi' | 'en';
  items: RecentAssignmentItem[];
  formatDateLabel: (value?: string | number | Date | null, pattern?: string) => string;
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={BookOpen}
      title={t.parent.homeworkTracker}
      subtitle={t.parent.recentHomework}
    >
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-[22px] border border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t.parent.due}: {formatDateLabel(item.dueDate, 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px] font-bold',
                    item.statusTone === 'green' &&
                      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                    item.statusTone === 'orange' &&
                      'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400',
                    item.statusTone === 'red' &&
                      'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                  )}
                >
                  {item.statusLabel}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {item.gradeLabel}
                </p>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {t.parent.viewDetails}
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-100 dark:border-slate-700 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t.parent.noHomework}
        </div>
      )}
    </SectionCard>
  );
}
