import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiRequest } from '../../../lib/api/apiClient';
import { auth } from '../../../lib/auth/sessionAuth';
import { Student, Evaluation } from '../../../types';
import { getFeedbackPrompt } from '../../../lib/evaluations/generateFeedback';
import {
  evaluationFeedbackJsonSchema,
  parseGeneratedEvaluationFeedback,
} from '../../../lib/evaluations/aiFeedback';
import { EVALUATION_COMMENT_LIMITS, limitTextLength } from '../../../lib/evaluations/commentLimits';
import { filterByTerm } from '../../../lib/academic/termUtils';
import { getVNTodayStr } from '../../../lib/core/utils';
import { getScheduledClassDatesInRange } from '../../../../shared/classSchedule';
import type { EvaluationRank } from '../../../../shared/evaluationRank';
import { normalizeEvaluationRank } from '../../../../shared/evaluationRank';

type EvaluationFormData = {
  scores: {
    attendance: number | '';
    effort: number | '';
    pronunciation: number | '';
    homework: number | '';
    behavior: number | '';
  };
  finalScore?: number | '';
  evaluationType: 'midterm' | 'final';
  rank: EvaluationRank;
  positivePoints: string;
  improvementPoints: string;
};

export function useEvaluationModal({
  classId,
  classData,
  coursePeriod,
  evaluations,
  attendanceData,
  assignments,
  submissions,
  filteredClassEvaluations,
  handleSendZaloEvaluation,
  t,
}: {
  classId: string | undefined;
  classData: any;
  coursePeriod: { start: string; end: string };
  evaluations: Evaluation[];
  attendanceData: any[];
  assignments: any[];
  submissions: any[];
  filteredClassEvaluations: Evaluation[];
  handleSendZaloEvaluation: any;
  t: any;
}) {
  const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
  const [editingEvalId, setEditingEvalId] = useState<string | null>(null);
  const [selectedStudentForEval, setSelectedStudentForEval] = useState<Student | null>(null);
  const [isSavingEval, setIsSavingEval] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Eval Select Modal state
  const [isEvalSelectOpen, setIsEvalSelectOpen] = useState(false);
  const [selectedStudentForSelect, setSelectedStudentForSelect] = useState<Student | null>(null);
  const [selectMidtermEval, setSelectMidtermEval] = useState<Evaluation | null>(null);
  const [selectFinalEval, setSelectFinalEval] = useState<Evaluation | null>(null);
  const [hideTypeSelector, setHideTypeSelector] = useState(false);

  // Delete eval state
  const [isDeletingEval, setIsDeletingEval] = useState(false);
  const [evalToDelete, setEvalToDelete] = useState<string | null>(null);

  const [evalFormData, setEvalFormData] = useState<EvaluationFormData>({
    scores: {
      attendance: 100,
      effort: '',
      pronunciation: '',
      homework: 100,
      behavior: '',
    },
    finalScore: '',
    evaluationType: 'midterm',
    rank: 'none',
    positivePoints: '',
    improvementPoints: '',
  });

  const resetEvaluationModalState = () => {
    setIsEvalModalOpen(false);
    setEditingEvalId(null);
    setSelectedStudentForEval(null);
    setEvalFormData({
      scores: { attendance: 100, effort: '', pronunciation: '', homework: 100, behavior: '' },
      finalScore: '',
      evaluationType: 'midterm',
      rank: 'none',
      positivePoints: '',
      improvementPoints: '',
    });
  };

  const calculateScoresForStudent = (student: Student) => {
    // Calculate attendance score for this course period
    const startStr = coursePeriod.start || classData.startDate;
    const endStr = coursePeriod.end || classData.endDate;
    const todayStr = getVNTodayStr();
    const rangeEndStr = !endStr || endStr > todayStr ? todayStr : endStr;

    const totalSessions =
      startStr && rangeEndStr
        ? getScheduledClassDatesInRange(classData, startStr, rangeEndStr).length
        : 0;

    const absences = attendanceData.filter(
      (a) => a.studentId === student.id && a.status === 'absent'
    ).length;

    let attendanceScore = 100;
    if (totalSessions > 0) {
      attendanceScore = Math.max(0, Math.round(((totalSessions - absences) / totalSessions) * 100));
    }

    const matchedTerm = classData.terms?.find(
      (t: any) => t.startDate === (coursePeriod.start || classData.startDate)
    );
    const selectedTermId = matchedTerm ? matchedTerm.id : 'current';

    const termAssignments = filterByTerm(
      assignments,
      (a: any) => a.createdAt,
      classData,
      selectedTermId
    );

    let homeworkScore = 100;
    if (termAssignments.length > 0) {
      const submittedCount = termAssignments.filter((a: any) =>
        submissions.some((s: any) => s.assignmentId === a.id && s.studentId === student.id)
      ).length;
      homeworkScore = Math.round((submittedCount / termAssignments.length) * 100);
    }

    return { attendanceScore, homeworkScore };
  };

  const handleGenerateAIFeedback = async () => {
    if (!selectedStudentForEval) return;
    setIsGeneratingAI(true);
    try {
      const { generateAIContent } = await import('../../../lib/api/aiService');

      const absences = attendanceData.filter(
        (a) => a.studentId === selectedStudentForEval.id && a.status === 'absent'
      ).length;

      const studentEvals = evaluations
        .filter((ev) => ev.studentId === selectedStudentForEval.id && ev.id !== editingEvalId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const recentEvaluations = studentEvals.slice(0, 3);

      const prompt = getFeedbackPrompt(
        selectedStudentForEval.name,
        absences,
        evalFormData.scores,
        evalFormData.finalScore,
        recentEvaluations
      );

      const text = await generateAIContent({
        prompt,
        model: 'gemini-3.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: evaluationFeedbackJsonSchema,
        },
      });

      if (text) {
        const result = parseGeneratedEvaluationFeedback(text);
        setEvalFormData((prev) => ({
          ...prev,
          positivePoints: limitTextLength(
            String(result.positivePoints || ''),
            EVALUATION_COMMENT_LIMITS.good
          ),
          improvementPoints: limitTextLength(
            String(result.improvementPoints || ''),
            EVALUATION_COMMENT_LIMITS.bad
          ),
        }));
      }
    } catch (error) {
      console.error('Error generating AI feedback:', error);
      toast.error(t.aiEvalError);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const buildEvaluationSaveData = (student: Student, formData: EvaluationFormData) => {
    const totalScore = Math.round(
      ((Number(formData.scores.attendance) || 0) +
        (Number(formData.scores.effort) || 0) +
        (Number(formData.scores.pronunciation) || 0) +
        (Number(formData.scores.homework) || 0) +
        (Number(formData.scores.behavior) || 0)) /
        5
    );

    const positivePoints = limitTextLength(formData.positivePoints, EVALUATION_COMMENT_LIMITS.good);
    const improvementPoints = limitTextLength(
      formData.improvementPoints,
      EVALUATION_COMMENT_LIMITS.bad
    );
    const data: Record<string, any> = {
      studentId: student.id,
      classId: classId,
      evaluationType: formData.evaluationType,
      scores: formData.scores,
      totalScore,
      positivePoints: positivePoints.split('\n').filter((p) => p.trim() !== ''),
      improvementPoints,
      rank: normalizeEvaluationRank(formData.rank),
    };

    if (formData.finalScore !== undefined && formData.finalScore !== '') {
      data.finalScore = formData.finalScore;
    } else {
      data.finalScore = null;
    }

    return data;
  };

  const saveEvaluationRecord = async (student: Student, formData: EvaluationFormData) => {
    const data = buildEvaluationSaveData(student, formData);

    if (editingEvalId) {
      await apiRequest('/api/v1/edu/evaluation-update', {
        method: 'PUT',
        body: { id: editingEvalId, ...data },
      });
      return;
    }

    const termToUse = classData?.terms?.find(
      (termItem: any) => termItem.startDate === (coursePeriod.start || classData.startDate)
    );
    const evalDate = termToUse ? termToUse.endDate : getVNTodayStr();
    const termFields = termToUse
      ? {
          termId: termToUse.id,
          termStart: termToUse.startDate,
          termEnd: termToUse.endDate,
        }
      : {
          termId: 'current',
          termStart: classData.startDate,
          termEnd: classData.endDate,
        };

    await apiRequest('/api/v1/edu/evaluation-create', {
      method: 'POST',
      body: { ...data, ...termFields, date: evalDate },
    });
  };

  const handleEvalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedStudentForEval || !classId || isSavingEval) return;

    setIsSavingEval(true);

    try {
      await saveEvaluationRecord(selectedStudentForEval, evalFormData);
      toast.success(editingEvalId ? t.evalUpdated : t.evalSaved);
      resetEvaluationModalState();
    } catch (err) {
      console.error('Error saving evaluation:', err);
      toast.error(t.evalSaveError + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingEval(false);
    }
  };

  const handleSendZaloEvaluationAndSave = async (
    student: Student,
    formData: EvaluationFormData
  ) => {
    if (!auth.currentUser || !classId || isSavingEval) return;

    const sent = await handleSendZaloEvaluation(student, formData);
    if (!sent) return;

    setIsSavingEval(true);

    try {
      await saveEvaluationRecord(student, formData);
      toast.success(editingEvalId ? t.evalUpdated : t.evalSaved);
      resetEvaluationModalState();
    } catch (err) {
      console.error('Error saving evaluation after Zalo send:', err);
      toast.error(t.evalZaloSaveError + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingEval(false);
    }
  };

  const handleEditEval = (ev: Evaluation, student: Student) => {
    setHideTypeSelector(true);
    setSelectedStudentForEval(student);
    setEditingEvalId(ev.id);
    setEvalFormData({
      scores: ev.scores,
      finalScore: ev.finalScore !== undefined && ev.finalScore !== null ? ev.finalScore : '',
      evaluationType: (ev.evaluationType as 'midterm' | 'final') || 'midterm',
      rank: normalizeEvaluationRank(ev.rank),
      positivePoints: limitTextLength(ev.positivePoints.join('\n'), EVALUATION_COMMENT_LIMITS.good),
      improvementPoints: limitTextLength(ev.improvementPoints || '', EVALUATION_COMMENT_LIMITS.bad),
    });
    setIsEvalModalOpen(true);
  };

  const handleOpenEvalModal = (student: Student) => {
    setEditingEvalId(null);
    setSelectedStudentForEval(student);

    const { attendanceScore, homeworkScore } = calculateScoresForStudent(student);

    // Auto-detect if midterm exists and final doesn't, default to final
    const studentEvals = filteredClassEvaluations.filter((ev) => ev.studentId === student.id);
    const hasMidterm = studentEvals.some((ev) => ev.evaluationType === 'midterm');
    const hasFinal = studentEvals.some((ev) => ev.evaluationType === 'final');

    let defaultEvalType: 'midterm' | 'final' = 'midterm';
    if (hasMidterm && !hasFinal) {
      defaultEvalType = 'final';
    } else if (hasFinal && !hasMidterm) {
      defaultEvalType = 'midterm';
    }

    setEvalFormData({
      scores: {
        attendance: attendanceScore,
        effort: '',
        pronunciation: '',
        homework: homeworkScore,
        behavior: '',
      },
      evaluationType: defaultEvalType,
      rank: 'none',
      positivePoints: '',
      improvementPoints: '',
    });
    setIsEvalModalOpen(true);
  };

  const handleOpenEvalSelect = (
    student: Student,
    midtermEval: Evaluation | null,
    finalEval: Evaluation | null
  ) => {
    setSelectedStudentForSelect(student);
    setSelectMidtermEval(midtermEval);
    setSelectFinalEval(finalEval);
    setIsEvalSelectOpen(true);
  };

  const handleSelectEvalType = (type: 'midterm' | 'final', existingEval?: Evaluation) => {
    setHideTypeSelector(true);
    if (existingEval) {
      // View/edit existing evaluation
      handleEditEval(existingEval, selectedStudentForSelect!);
    } else {
      // Create new evaluation with specific type
      setEditingEvalId(null);
      setSelectedStudentForEval(selectedStudentForSelect);

      const { attendanceScore, homeworkScore } = calculateScoresForStudent(
        selectedStudentForSelect!
      );

      setEvalFormData({
        scores: {
          attendance: attendanceScore,
          effort: '',
          pronunciation: '',
          homework: homeworkScore,
          behavior: '',
        },
        evaluationType: type,
        rank: 'none',
        positivePoints: '',
        improvementPoints: '',
      });
      setIsEvalModalOpen(true);
    }
  };

  const handleDeleteEval = async (id: string) => {
    setEvalToDelete(id);
  };

  const confirmDeleteEval = async () => {
    if (isDeletingEval || !evalToDelete) return;
    setIsDeletingEval(true);
    try {
      await apiRequest('/api/v1/edu/evaluation-delete', {
        method: 'DELETE',
        body: { id: evalToDelete },
      });
      toast.success(t.evalDeleted);
      setEvalToDelete(null);
    } catch (err) {
      console.error('Error deleting evaluation:', err);
      toast.error(t.evalDeleteError);
    } finally {
      setIsDeletingEval(false);
    }
  };

  return {
    isEvalModalOpen,
    setIsEvalModalOpen,
    editingEvalId,
    setEditingEvalId,
    selectedStudentForEval,
    setSelectedStudentForEval,
    evalFormData,
    setEvalFormData,
    isSavingEval,
    isGeneratingAI,
    handleGenerateAIFeedback,
    resetEvaluationModalState,
    handleEvalSubmit,
    handleSendZaloEvaluationAndSave,
    handleEditEval,
    handleOpenEvalModal,
    // Eval Select Modal
    isEvalSelectOpen,
    setIsEvalSelectOpen,
    selectedStudentForSelect,
    selectMidtermEval,
    selectFinalEval,
    hideTypeSelector,
    handleOpenEvalSelect,
    handleSelectEvalType,
    // Delete eval
    isDeletingEval,
    evalToDelete,
    setEvalToDelete,
    handleDeleteEval,
    confirmDeleteEval,
  };
}
