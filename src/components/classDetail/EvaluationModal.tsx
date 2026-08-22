import React from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';
import { Student, Class } from '../../types';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';
import { EVALUATION_COMMENT_LIMITS, limitTextLength } from '../../lib/evaluations/commentLimits';
import type { EvaluationRank } from '../../../shared/evaluationRank';

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  classData: Class;
  editingEvalId: string | null;
  formData: {
    scores: {
      attendance: number | '';
      effort: number | '';
      pronunciation: number | '';
      homework: number | '';
      behavior: number | '';
    };
    finalScore?: number | '';
    evaluationType: 'midterm' | 'final';
    rank?: EvaluationRank;
    positivePoints: string;
    improvementPoints: string;
  };
  setFormData: (data: any) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSaving: boolean;
  onGenerateAIFeedback?: () => void;
  isGeneratingAI?: boolean;
  onSendZaloEvaluation?: (
    student: Student,
    formData: EvaluationModalProps['formData']
  ) => void | Promise<void>;
  isSendingZalo?: boolean;
  hideTypeSelector?: boolean;
}

export function EvaluationModal({
  isOpen,
  onClose,
  student,
  classData,
  editingEvalId,
  formData,
  setFormData,
  onSubmit,
  isSaving,
  onGenerateAIFeedback,
  isGeneratingAI,
  hideTypeSelector,
}: EvaluationModalProps) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  if (!isOpen || !student) return null;

  // Calculate totalScore for display
  const totalScore = Math.round(
    ((Number(formData.scores.attendance) || 0) +
      (Number(formData.scores.effort) || 0) +
      (Number(formData.scores.pronunciation) || 0) +
      (Number(formData.scores.homework) || 0) +
      (Number(formData.scores.behavior) || 0)) /
      5
  );

  const positivePointsLength = formData.positivePoints.length;
  const improvementPointsLength = formData.improvementPoints.length;

  const rankOptions: Array<{ value: EvaluationRank; label: string }> = [
    { value: 'none', label: t.evaluationModal.rankNone },
    { value: 'first', label: t.evaluationModal.rankFirst },
    { value: 'second', label: t.evaluationModal.rankSecond },
  ];
  const selectedRank = formData.rank || 'none';

  return (
    <ModalPortal>
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
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-blue-600 text-white">
            <div>
              <h2 className="text-xl font-bold">
                {editingEvalId ? t.evaluationModal.editTitle : t.evaluationModal.createTitle}
              </h2>
              <p className="text-blue-100 text-sm">
                {student.name} • {classData.name}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.evaluationModal.close}
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={onSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
            {!hideTypeSelector && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  {t.evaluationModal.evaluationType}
                </label>
                <div className="flex space-x-3">
                  {(['midterm', 'final'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormData({ ...formData, evaluationType: type })}
                      className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all border ${
                        formData.evaluationType === type
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                          : 'bg-white border-slate-100 text-slate-600 hover:border-blue-300'
                      }`}
                    >
                      {type === 'midterm'
                        ? t.evaluationModal.midtermLabel
                        : t.evaluationModal.finalLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <label className="block text-sm font-bold text-slate-700 mb-2">
                {t.evaluationModal.rankLabel}
              </label>
              <div className="grid grid-cols-3 gap-3">
                {rankOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, rank: option.value })}
                    className={`py-2 px-3 rounded-lg text-sm font-bold transition-all border ${
                      selectedRank === option.value
                        ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                        : 'bg-white border-slate-100 text-slate-600 hover:border-blue-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.attendanceLabel}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={formData.scores.attendance}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      scores: {
                        ...formData.scores,
                        attendance: e.target.value === '' ? '' : parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.effortLabel}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={formData.scores.effort}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      scores: {
                        ...formData.scores,
                        effort: e.target.value === '' ? '' : parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.pronunciationLabel}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={formData.scores.pronunciation}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      scores: {
                        ...formData.scores,
                        pronunciation: e.target.value === '' ? '' : parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.homeworkLabel}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={formData.scores.homework}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      scores: {
                        ...formData.scores,
                        homework: e.target.value === '' ? '' : parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.behaviorLabel}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={formData.scores.behavior}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      scores: {
                        ...formData.scores,
                        behavior: e.target.value === '' ? '' : parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t.evaluationModal.finalExamLabel}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={formData.finalScore === undefined ? '' : formData.finalScore}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      finalScore: e.target.value === '' ? '' : parseInt(e.target.value),
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="e.g. 95"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onGenerateAIFeedback}
                disabled={isGeneratingAI}
                className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGeneratingAI ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <span className="text-lg leading-none">✨</span>
                )}
                <span>{t.evaluationModal.generateAI}</span>
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">
                  {t.evaluationModal.positiveLabel}
                </label>
                <span className="text-xs font-medium text-slate-500">
                  {positivePointsLength}/{EVALUATION_COMMENT_LIMITS.good}
                </span>
              </div>
              <textarea
                required
                maxLength={EVALUATION_COMMENT_LIMITS.good}
                value={formData.positivePoints}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    positivePoints: limitTextLength(e.target.value, EVALUATION_COMMENT_LIMITS.good),
                  })
                }
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder={t.evaluationModal.positivePlaceholder}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">
                  {t.evaluationModal.improvementLabel}
                </label>
                <span className="text-xs font-medium text-slate-500">
                  {improvementPointsLength}/{EVALUATION_COMMENT_LIMITS.bad}
                </span>
              </div>
              <textarea
                maxLength={EVALUATION_COMMENT_LIMITS.bad}
                value={formData.improvementPoints}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    improvementPoints: limitTextLength(
                      e.target.value,
                      EVALUATION_COMMENT_LIMITS.bad
                    ),
                  })
                }
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder={t.evaluationModal.improvementPlaceholder}
              />
            </div>

            <div className="pt-4 flex flex-col space-y-3">
              {/* Main action row */}
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {t.evaluationModal.saving}
                    </>
                  ) : editingEvalId ? (
                    t.evaluationModal.updateRecord
                  ) : (
                    t.evaluationModal.saveRecord
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
