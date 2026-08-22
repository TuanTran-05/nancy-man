import React from 'react';
import { X, UserPlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/core/utils';
import { getRequiredSessions } from '../../../lib/classes/courseDateUtils';
import { formatClassNameWithTeacher } from '../../../lib/classes/sortClasses';
import { ModalPortal } from '../../../components/common/ModalPortal';
import { Class } from '../../../types';
import { ApiDateTextInput, ApiTimeTextInput } from '../../../components/forms/ApiDateTimeInputs';

interface ClassFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingClass: Class | null;
  formData: any;
  setFormData: (val: any) => void;
  teachers: Array<{ uid: string; displayName: string; email: string }>;
  sourceClasses: any[];
  importSourceClassId: string;
  setImportSourceClassId: (val: string) => void;
  hasFullAcademicAccess: boolean;
  canManageClassFinance: boolean;
  classTeacherLookup: any[];
  isSaving: boolean;
  isImporting: boolean;
  language: string;
  t: any;
  translations: any;
  handleSubmit: (e: React.FormEvent) => void;
}

export function ClassFormModal({
  isOpen,
  onClose,
  editingClass,
  formData,
  setFormData,
  teachers,
  sourceClasses,
  importSourceClassId,
  setImportSourceClassId,
  hasFullAcademicAccess,
  canManageClassFinance,
  classTeacherLookup,
  isSaving,
  isImporting,
  language,
  t,
  translations,
  handleSubmit,
}: ClassFormModalProps) {
  if (!isOpen) return null;

  const weeklySessions = Array.isArray(formData.weeklySessions)
    ? formData.weeklySessions
    : [
        {
          dayOfWeek: 1,
          startTime: formData.startTime || '',
          endTime: '',
          room: formData.room || '',
        },
      ];
  const usedDays = new Set(weeklySessions.map((session: any) => Number(session.dayOfWeek)));
  const nextAvailableDay = t.days.findIndex((_: string, index: number) => !usedDays.has(index));
  const updateWeeklySession = (index: number, patch: Record<string, unknown>) => {
    setFormData({
      ...formData,
      weeklySessions: weeklySessions.map((session: any, currentIndex: number) =>
        currentIndex === index ? { ...session, ...patch } : session
      ),
    });
  };
  const removeWeeklySession = (index: number) => {
    setFormData({
      ...formData,
      weeklySessions: weeklySessions.filter(
        (_: any, currentIndex: number) => currentIndex !== index
      ),
    });
  };

  return (
    <ModalPortal lockScroll trapFocus>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] overscroll-contain"
        >
          <div className="p-6 border-b border-border-light flex items-center justify-between shrink-0">
            <h2 className="text-xl font-bold text-heading">
              {editingClass ? t.editClass : t.createClass}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>
          <form
            onSubmit={handleSubmit}
            className="p-6 space-y-4 overflow-y-auto overscroll-contain flex-1"
          >
            {hasFullAcademicAccess ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.classNameLabel}
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder={t.classNamePlaceholder}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.gradeLabel}
                  </label>
                  <select
                    value={formData.grade}
                    onChange={(e) => {
                      setFormData({ ...formData, grade: e.target.value });
                      setImportSourceClassId('');
                    }}
                    className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">{t.selectGrade}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>
                        {t.gradeOption.replace('{grade}', String(g))}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.teacherLabel}
                  </label>
                  <div className="relative">
                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle w-4 h-4" />
                    <select
                      required
                      value={formData.teacherId}
                      onChange={(e) => setFormData({ ...formData, teacherId: e.target.value })}
                      className="w-full pl-10 pr-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                    >
                      <option value="">{t.selectTeacher}</option>
                      {teachers.map((tc) => (
                        <option key={tc.uid} value={tc.uid}>
                          {tc.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {canManageClassFinance && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.salaryLabel}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={formData.salaryPerSession || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, salaryPerSession: Number(e.target.value) })
                      }
                      onWheel={(event) => event.currentTarget.blur()}
                      className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder={t.salaryPlaceholder}
                    />
                  </div>
                )}
                {canManageClassFinance && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.tuitionFeeLabel}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={formData.tuitionFee || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, tuitionFee: Number(e.target.value) })
                      }
                      onWheel={(event) => event.currentTarget.blur()}
                      className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder={t.tuitionFeePlaceholder}
                    />
                  </div>
                )}

                {/* Import students from previous grade */}
                {!editingClass && sourceClasses.length > 0 && (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                    <div className="flex items-center space-x-2 mb-2">
                      <UserPlus className="w-4 h-4 text-emerald-600" />
                      <label className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                        {t.importStudentsTitle}
                      </label>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">
                      {t.importStudentsDesc}
                    </p>
                    <select
                      value={importSourceClassId}
                      onChange={(e) => setImportSourceClassId(e.target.value)}
                      className="w-full px-4 py-2 bg-surface border border-emerald-200 dark:border-emerald-500/30 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                    >
                      <option value="">{t.selectSourceClass}</option>
                      {sourceClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatClassNameWithTeacher(c, classTeacherLookup)} (
                          {t.gradeOption.replace('{grade}', String(c.grade))})
                        </option>
                      ))}
                    </select>
                    {importSourceClassId && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2 italic">
                        {t.importNote}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-100">
                <p className="text-sm font-bold text-blue-900">{formData.name}</p>
                <p className="text-xs text-blue-600 mt-1">{t.statusOnlyMsg}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.classStatus}
              </label>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {(['active', 'paused', 'archived'] as const).map((s) => {
                  const isDisabled = !hasFullAcademicAccess && s === 'archived';
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => setFormData({ ...formData, status: s })}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-xs font-bold transition-all capitalize',
                        formData.status === s
                          ? 'bg-surface text-blue-600 shadow-sm dark:shadow-black/20'
                          : 'text-muted hover:text-slate-700',
                        isDisabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {s === 'active'
                        ? t.filterActive
                        : s === 'paused'
                          ? t.filterPaused
                          : t.filterArchived}
                    </button>
                  );
                })}
              </div>
            </div>

            {hasFullAcademicAccess && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <ApiDateTextInput
                      label={t.startDate}
                      required
                      value={formData.startDate}
                      onChange={(startDate) => setFormData({ ...formData, startDate })}
                      inputClassName="w-full px-4 py-2 bg-page border-border-default rounded-xl focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <ApiDateTextInput
                      label={t.endDate}
                      required
                      value={formData.endDate}
                      onChange={(endDate) => setFormData({ ...formData, endDate })}
                      inputClassName="w-full px-4 py-2 bg-page border-border-default rounded-xl focus:ring-blue-500"
                    />
                    {!editingClass && formData.startDate && formData.endDate && (
                      <p className="text-xs text-blue-500 mt-1">
                        {getRequiredSessions(formData.grade ? Number(formData.grade) : undefined)}{' '}
                        {translations[language].classesPage.sessions}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-sm font-medium text-slate-700">
                      {t.weeklySessionsTitle || t.scheduleWeek}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (nextAvailableDay < 0) return;
                        setFormData({
                          ...formData,
                          weeklySessions: [
                            ...weeklySessions,
                            { dayOfWeek: nextAvailableDay, startTime: '', endTime: '', room: '' },
                          ],
                        });
                      }}
                      disabled={nextAvailableDay < 0}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.addWeeklySession}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {weeklySessions.map((session: any, index: number) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-lg border border-border-light p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                      >
                        <label className="text-xs font-bold text-slate-600">
                          {t.sessionDay}
                          <select
                            value={session.dayOfWeek}
                            onChange={(event) =>
                              updateWeeklySession(index, { dayOfWeek: Number(event.target.value) })
                            }
                            className="mt-1 w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm font-semibold"
                          >
                            {t.days.map((dayName: string, dayIndex: number) => (
                              <option
                                key={dayName}
                                value={dayIndex}
                                disabled={
                                  usedDays.has(dayIndex) && Number(session.dayOfWeek) !== dayIndex
                                }
                              >
                                {dayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <ApiTimeTextInput
                          label={t.sessionStartTime || t.startTime}
                          required
                          value={session.startTime || ''}
                          onChange={(startTime) => updateWeeklySession(index, { startTime })}
                        />
                        <ApiTimeTextInput
                          label={t.sessionEndTime}
                          required
                          value={session.endTime || ''}
                          onChange={(endTime) => updateWeeklySession(index, { endTime })}
                        />
                        <label className="text-xs font-bold text-slate-600">
                          {t.sessionRoom}
                          <input
                            type="text"
                            value={session.room || ''}
                            onChange={(event) =>
                              updateWeeklySession(index, { room: event.target.value })
                            }
                            className="mt-1 w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm font-semibold"
                            placeholder={t.roomPlaceholder}
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={t.removeWeeklySession}
                          onClick={() => removeWeeklySession(index)}
                          disabled={weeklySessions.length <= 1}
                          className="self-end rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.roomLabel}
                  </label>
                  <input
                    type="text"
                    value={formData.room}
                    onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                    className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder={t.roomPlaceholder}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.descLabel}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                    placeholder={t.descPlaceholder}
                  />
                </div>
              </>
            )}
            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-border-default text-slate-600 font-medium rounded-xl hover:bg-hover transition-colors"
              >
                {translations[language].common.cancel}
              </button>
              <button
                type="submit"
                disabled={isSaving || isImporting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {(isSaving || isImporting) && <Loader2 className="w-4 h-4 animate-spin" />}
                {isImporting
                  ? t.importingBtn || translations[language].classesPage.importing
                  : isSaving
                    ? translations[language].classesPage.saving
                    : editingClass
                      ? t.saveChanges
                      : t.createClass}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
