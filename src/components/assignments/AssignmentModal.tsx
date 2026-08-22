import React from 'react';
import { motion } from 'framer-motion';
import {
  X,
  FileText,
  List,
  HelpCircle,
  PlusCircle,
  FileJson,
  Trash2,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { Assignment, Class, QuizQuestion, UserProfile } from '../../types';
import { cn } from '../../lib/core/utils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import {
  formatClassNameWithTeacher,
  sortClassesByTeacherThenName,
} from '../../lib/classes/sortClasses';

import { DateTimeTextInput } from '../forms/DateTimeTextInput';
import type { AssignmentProctoringMode } from '../../../shared/assignmentProctoring';

interface AssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingAssignment: Assignment | null;
  formData: {
    title: string;
    description: string;
    dueDate: string;
    classId: string;
    type: 'essay' | 'quiz';
    questions: QuizQuestion[];
    attemptsAllowed: number;
    proctoringMode: AssignmentProctoringMode;
  };
  setFormData: (data: any) => void;
  classes: Class[];
  teachers?: Pick<UserProfile, 'uid' | 'displayName'>[];
  onSubmit: (e: React.FormEvent) => void;
  isSaving: boolean;
  jsonInput: string;
  setJsonInput: (val: string) => void;
  onImportJson: () => void;
  onAddQuestion: () => void;
  onUpdateQuestion: (id: number, updates: Partial<QuizQuestion>) => void;
  onRemoveQuestion: (id: number) => void;
}

export function AssignmentModal({
  isOpen,
  onClose,
  editingAssignment,
  formData,
  setFormData,
  classes,
  teachers = [],
  onSubmit,
  isSaving,
  jsonInput,
  setJsonInput,
  onImportJson,
  onAddQuestion,
  onUpdateQuestion,
  onRemoveQuestion,
}: AssignmentModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const sortedClasses = sortClassesByTeacherThenName(classes, teachers);
  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-blue-600 text-white">
            <h2 className="text-xl font-bold">
              {editingAssignment ? t.assignmentModal.editTitle : t.assignmentModal.createTitle}
            </h2>
            <button
              type="button"
              aria-label={t.assignmentModal.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <form onSubmit={onSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="flex p-1 bg-slate-100 dark:bg-slate-700 rounded-xl mb-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, type: 'essay' })}
                className={cn(
                  'flex-1 flex items-center justify-center space-x-2 py-2 rounded-lg text-sm font-medium transition-all',
                  formData.type === 'essay'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                )}
              >
                <FileText className="w-4 h-4" />
                <span>{t.assignmentModal.essayType}</span>
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, type: 'quiz' })}
                className={cn(
                  'flex-1 flex items-center justify-center space-x-2 py-2 rounded-lg text-sm font-medium transition-all',
                  formData.type === 'quiz'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                )}
              >
                <List className="w-4 h-4" />
                <span>{t.assignmentModal.quizType}</span>
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                {t.assignmentModal.proctoringMode}
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={formData.proctoringMode === 'strict'}
                  onClick={() => setFormData({ ...formData, proctoringMode: 'strict' })}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-all',
                    formData.proctoringMode === 'strict'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200'
                      : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-blue-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  )}
                >
                  <span className="block text-sm font-bold">{t.assignmentModal.strictMode}</span>
                  <span className="mt-1 block text-xs leading-5">
                    {t.assignmentModal.strictModeHint}
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={formData.proctoringMode === 'normal'}
                  onClick={() => setFormData({ ...formData, proctoringMode: 'normal' })}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-all',
                    formData.proctoringMode === 'normal'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-200'
                      : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-emerald-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  )}
                >
                  <span className="block text-sm font-bold">{t.assignmentModal.normalMode}</span>
                  <span className="mt-1 block text-xs leading-5">
                    {t.assignmentModal.normalModeHint}
                  </span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t.assignmentModal.titleLabel}
              </label>
              <input
                required
                maxLength={100}
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder={t.assignmentModal.titlePlaceholder}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t.assignmentModal.descLabel}
              </label>
              <textarea
                required
                maxLength={10000}
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"
                placeholder={t.assignmentModal.contentPlaceholder}
              />
            </div>

            {formData.type === 'quiz' && (
              <div className="space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center">
                    <HelpCircle className="w-4 h-4 mr-2 text-blue-600" />
                    {t.assignmentModal.questionList.replace(
                      '{count}',
                      String(formData.questions.length)
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={onAddQuestion}
                    className="text-xs flex items-center text-blue-600 hover:underline font-medium"
                  >
                    <PlusCircle className="w-3 h-3 mr-1" />
                    {t.assignmentModal.addQuestion}
                  </button>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-indigo-500/10 rounded-xl border border-blue-100 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-blue-700 flex items-center">
                      <FileJson className="w-3 h-3 mr-1" />
                      {t.assignmentModal.importFromJson}
                    </label>
                    <button
                      type="button"
                      onClick={onImportJson}
                      disabled={!jsonInput.trim()}
                      className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {t.assignmentModal.importCode}
                    </button>
                  </div>

                  <div className="p-3 bg-white dark:bg-slate-700 rounded-lg border border-blue-200 dark:border-slate-600">
                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                      💡 <span className="font-semibold">{t.assignmentModal.aiHint}</span>{' '}
                      {t.assignmentModal.aiHintDesc}
                    </p>
                    <a
                      href="https://ai.studio/apps/a2ed745b-a35a-4f9f-a853-07abfc15a8f6?fullscreenApplet=true"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium text-xs underline hover:no-underline"
                    >
                      {t.assignmentModal.createWithAI}
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </a>
                  </div>

                  <textarea
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-blue-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                    placeholder='[{"question_content": "...", "options": [...], "correct_answer": "A"}]'
                  />
                </div>

                <div className="space-y-4">
                  {formData.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-700 relative group"
                    >
                      <button
                        type="button"
                        onClick={() => onRemoveQuestion(q.id)}
                        className="absolute top-2 right-2 p-1 text-slate-400 dark:text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {t.assignmentModal.questionPrefix} {idx + 1}
                          </label>
                          <input
                            type="text"
                            value={q.question_content}
                            onChange={(e) =>
                              onUpdateQuestion(q.id, { question_content: e.target.value })
                            }
                            className="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder={t.assignmentModal.questionPlaceholder}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {q.options.map((opt, optIdx) => (
                            <div key={opt.key} className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                                {opt.key}
                              </span>
                              <input
                                type="text"
                                value={opt.text}
                                onChange={(e) => {
                                  const newOptions = [...q.options];
                                  newOptions[optIdx] = { ...opt, text: e.target.value };
                                  onUpdateQuestion(q.id, { options: newOptions });
                                }}
                                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                                placeholder={t.assignmentModal.optionPlaceholder.replace(
                                  '{key}',
                                  opt.key
                                )}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between pt-2">
                          <div className="flex items-center space-x-4">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mr-2">
                                {t.assignmentModal.correctAnswer}
                              </label>
                              <select
                                value={q.correct_answer}
                                onChange={(e) =>
                                  onUpdateQuestion(q.id, { correct_answer: e.target.value })
                                }
                                className="text-xs bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded px-1 py-0.5"
                              >
                                {['A', 'B', 'C', 'D'].map((key) => (
                                  <option key={key} value={key}>
                                    {key}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mr-2">
                                {t.assignmentModal.difficulty}
                              </label>
                              <select
                                value={q.level}
                                onChange={(e) => onUpdateQuestion(q.id, { level: e.target.value })}
                                className="text-xs bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded px-1 py-0.5"
                              >
                                {(t.assignmentModal.levels as string[]).map((l: string) => (
                                  <option key={l} value={l}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <DateTimeTextInput
                mode="datetime"
                label={t.assignmentModal.dueDate}
                value={formData.dueDate}
                onChange={(value) =>
                  setFormData((current: any) => ({ ...current, dueDate: value }))
                }
                required
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  {t.assignmentModal.classLabel}
                </label>
                <select
                  required
                  value={formData.classId}
                  onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="">{t.assignmentModal.selectClass}</option>
                  {sortedClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatClassNameWithTeacher(c, teachers)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t.assignmentModal.maxAttempts}
              </label>
              <input
                required
                type="number"
                min="1"
                value={formData.attemptsAllowed}
                onChange={(e) =>
                  setFormData({ ...formData, attemptsAllowed: parseInt(e.target.value) || 1 })
                }
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder={t.assignmentModal.maxAttemptsPlaceholder}
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 italic">
                {t.assignmentModal.maxAttemptsHint}
              </p>
            </div>

            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-100 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {t.assignmentModal.cancel}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {t.assignmentModal.saving}
                  </>
                ) : editingAssignment ? (
                  t.assignmentModal.update
                ) : (
                  t.assignmentModal.assign
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
