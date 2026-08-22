import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, MessageSquare, Send, Sparkles, X } from 'lucide-react';
import { Class, QuickNotifyTemplateKey, Student } from '../../types';
import { cn, formatVN } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';

type NotifyMode = 'template' | 'manual';

interface QuickNotifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  classData: Class;
  students: Student[];
  defaultStudentIds: string[];
  defaultTemplateKey?: QuickNotifyTemplateKey;
  contextDate: string;
  isSending: boolean;
  onSend: (payload: {
    studentId: string;
    title: string;
    message: string;
    type: 'absence' | 'missing_assignment' | 'general';
    templateKey?: QuickNotifyTemplateKey;
    contextDate?: string;
  }) => Promise<void>;
  studentMissingAssignments?: Map<string, string[]>;
}

const getTemplateOptions = (t: any): Array<{ key: QuickNotifyTemplateKey; label: string }> => [
  { key: 'absence_today', label: t.quickNotifyModal.templates.absence },
  { key: 'late_today', label: t.quickNotifyModal.templates.late },
  { key: 'missing_assignment', label: t.quickNotifyModal.templates.missingAssignment },
  { key: 'support_needed', label: t.quickNotifyModal.templates.parentSupport },
  { key: 'praise_progress', label: t.quickNotifyModal.templates.praise },
];

function buildTemplateCopy(
  templateKey: QuickNotifyTemplateKey,
  classData: Class,
  recipients: Student[],
  contextDate: string,
  studentMissingAssignments: Map<string, string[]> | undefined,
  t: ReturnType<typeof useLanguage>['t']
) {
  const T = t.quickNotifyModal;
  const recipientLabel =
    recipients.length === 1
      ? recipients[0].name
      : T.singleRecipientFallback.replace('{className}', classData.name);
  const shortDate = formatVN(contextDate, 'dd/MM/yyyy');

  let message = '';
  let type: 'absence' | 'missing_assignment' | 'general' = 'general';
  let title = '';

  switch (templateKey) {
    case 'absence_today':
      type = 'absence';
      title = T.absenceMsgTitle.replace('{date}', shortDate);
      message = T.absenceMsgBody
        .replace('{recipient}', recipientLabel)
        .replace('{date}', shortDate)
        .replace('{className}', classData.name);
      break;
    case 'late_today':
      title = T.lateMsgTitle.replace('{date}', shortDate);
      message = T.lateMsgBody
        .replace('{recipient}', recipientLabel)
        .replace('{date}', shortDate)
        .replace('{className}', classData.name);
      break;
    case 'missing_assignment':
      type = 'missing_assignment';
      title = T.missingMsgTitle;
      if (recipients.length === 1 && studentMissingAssignments) {
        const missing = studentMissingAssignments.get(recipients[0].id) || [];

        if (missing.length > 0) {
          const displayLimit = 10;
          const displayMissing = missing.slice(0, displayLimit);
          const remainingCount = missing.length - displayLimit;
          const listStr = displayMissing.map((item) => `• ${item}`).join('\n');
          const remainingStr =
            remainingCount > 0
              ? '\n' + T.manyOthers.replace('{count}', String(remainingCount))
              : '';

          message = T.missingMsgBodyList
            .replace('{student}', recipients[0].name)
            .replace('{count}', String(missing.length))
            .replace('{className}', classData.name)
            .replace('{list}', listStr)
            .replace('{remaining}', remainingStr);
        } else {
          message = T.missingMsgBodySingle
            .replace('{student}', recipients[0].name)
            .replace('{className}', classData.name);
        }
      } else {
        message = T.missingMsgBodyPlural
          .replace('{recipient}', recipientLabel)
          .replace('{className}', classData.name);
      }
      break;
    case 'support_needed':
      title = T.supportMsgTitle;
      message = T.supportMsgBody
        .replace('{recipient}', recipientLabel)
        .replace('{className}', classData.name);
      break;
    case 'praise_progress':
      title = T.praiseMsgTitle;
      message = T.praiseMsgBody
        .replace('{recipient}', recipientLabel)
        .replace('{className}', classData.name);
      break;
  }

  return { type, title, message };
}

export function QuickNotifyModal({
  isOpen,
  onClose,
  classData,
  students,
  defaultStudentIds,
  defaultTemplateKey = 'absence_today',
  contextDate,
  isSending,
  onSend,
  studentMissingAssignments,
}: QuickNotifyModalProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<NotifyMode>('template');
  const [templateKey, setTemplateKey] = useState<QuickNotifyTemplateKey>(defaultTemplateKey);
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultStudentIds);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wasOpenRef = useRef(false);

  const selectedStudents = useMemo(
    () => students.filter((student) => selectedIds.includes(student.id)),
    [students, selectedIds]
  );

  const selectedStudentIdKey = useMemo(() => defaultStudentIds.join('|'), [defaultStudentIds]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setSelectedIds(defaultStudentIds);
    setTemplateKey(defaultTemplateKey);
    setMode('template');
  }, [defaultStudentIds, defaultTemplateKey, isOpen, selectedStudentIdKey]);

  useEffect(() => {
    if (!isOpen || mode !== 'template') return;

    const copy = buildTemplateCopy(
      templateKey,
      classData,
      selectedStudents,
      contextDate,
      studentMissingAssignments,
      t
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect -- template choice intentionally controls editable fields.
    setTitle(copy.title);
    setMessage(copy.message);
  }, [
    classData,
    contextDate,
    isOpen,
    mode,
    selectedStudents,
    studentMissingAssignments,
    templateKey,
  ]);

  useEffect(() => {
    if (!isOpen || mode !== 'manual') return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- switching to manual starts with a blank draft.
    setTitle('');
    setMessage('');
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const toggleRecipient = (studentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedIds.length || !title.trim() || !message.trim() || isSending || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      for (const studentId of selectedIds) {
        let finalTitle = title.trim();
        let finalMessage = message.trim();
        let finalType: 'absence' | 'missing_assignment' | 'general' = 'general';

        if (mode === 'template') {
          const recipient = students.find((student) => student.id === studentId);
          const templateRecipients = recipient ? [recipient] : selectedStudents;
          const copy = buildTemplateCopy(
            templateKey,
            classData,
            templateRecipients,
            contextDate,
            studentMissingAssignments,
            t
          );

          finalTitle = copy.title;
          finalMessage = copy.message;
          finalType = copy.type;
        }

        await onSend({
          studentId,
          title: finalTitle,
          message: finalMessage,
          type: finalType,
          templateKey: mode === 'template' ? templateKey : undefined,
          contextDate,
        });
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSending || isSubmitting;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 20 }}
          className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-6 py-5 text-white">
            <div>
              <h2 className="text-xl font-bold">{t.quickNotifyModal.title}</h2>
              <p className="text-sm text-slate-300">
                {classData.name} • {formatVN(contextDate, 'dd/MM/yyyy')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 transition-colors hover:bg-white/10"
              aria-label={t.quickNotifyModal.close}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="grid min-h-0 gap-0 overflow-hidden lg:grid-cols-[320px,1fr]"
          >
            <div className="border-b border-slate-100 bg-slate-50/70 p-5 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex rounded-2xl border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setMode('template')}
                  className={cn(
                    'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors',
                    mode === 'template' ? 'bg-indigo-600 text-white' : 'text-slate-500'
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    {t.quickNotifyModal.quickTemplate}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className={cn(
                    'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors',
                    mode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-500'
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    {t.quickNotifyModal.manualCompose}
                  </span>
                </button>
              </div>

              {mode === 'template' && (
                <div className="space-y-2">
                  {getTemplateOptions(t).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setTemplateKey(option.key)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors',
                        templateKey === option.key
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">
                    {t.quickNotifyModal.recipients}
                  </p>
                  <span className="text-xs font-medium text-slate-400">
                    {t.quickNotifyModal.selected
                      .replace('{selected}', String(selectedIds.length))
                      .replace('{total}', String(students.length))}
                  </span>
                </div>
                <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                  {students.map((student) => {
                    const checked = selectedIds.includes(student.id);
                    return (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => toggleRecipient(student.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors',
                          checked
                            ? 'border-indigo-200 bg-indigo-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-md border text-white',
                            checked
                              ? 'border-indigo-600 bg-indigo-600'
                              : 'border-slate-300 bg-white text-transparent'
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {student.name}
                          </p>
                          <p className="text-xs text-slate-500">{student.studentId}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col p-5">
              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {t.quickNotifyModal.infoHint}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t.quickNotifyModal.titleLabel}
                  </label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-indigo-300"
                    placeholder={t.quickNotifyModal.titlePlaceholder}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t.quickNotifyModal.contentLabel}
                  </label>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className="min-h-[220px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-indigo-300"
                    placeholder={t.quickNotifyModal.contentPlaceholder}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  {t.quickNotifyModal.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isBusy || !selectedIds.length || !title.trim() || !message.trim()}
                  className="flex-1 rounded-2xl bg-indigo-600 px-4 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    {isBusy ? t.quickNotifyModal.sending : t.quickNotifyModal.send}
                  </span>
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
