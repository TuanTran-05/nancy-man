import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Evaluation, Student, UserProfile } from '../types';
import {
  getZaloSendCount,
  isValidVNPhone,
  sendZaloAbsenceNotification,
  sendZaloEvaluationNotification,
  sendZaloRankNotification,
} from '../lib/zalo/zaloService';
import { isRankedEvaluation, normalizeEvaluationRank } from '../../shared/evaluationRank';
import { AbsentMarkedEvent } from './useAttendanceManager';
import { useLanguage } from '../lib/i18n/useLanguage';
import { apiRequest } from '../lib/api/apiClient';

interface UseZaloNotificationsParams {
  classId: string | undefined;
  classData: { id: string; name: string; endDate?: string } | null;
  profile: UserProfile | null;
  students: Student[];
  notifyAbsenceDate: string | null;
}

interface EvaluationFormData {
  scores: {
    attendance: number | '';
    effort: number | '';
    pronunciation: number | '';
    homework: number | '';
    behavior: number | '';
  };
  finalScore?: number | '';
  rank?: Evaluation['rank'];
  positivePoints: string;
  improvementPoints: string;
}

export function useZaloNotifications({
  classId,
  classData,
  profile,
  students,
  notifyAbsenceDate,
}: UseZaloNotificationsParams) {
  const { t } = useLanguage();
  const [zaloConfirmData, setZaloConfirmData] = useState<{
    studentId: string;
    date: string;
    classId: string;
  } | null>(null);
  const [zaloEvalConfirmData, setZaloEvalConfirmData] = useState<{
    student: Student;
    evaluation: Evaluation;
  } | null>(null);
  const [isSendingZalo, setIsSendingZalo] = useState(false);
  const [zaloAbsenceCounts, setZaloAbsenceCounts] = useState<Record<string, number>>({});

  const checkZaloRateLimit = async (
    studentId: string,
    type: 'absence' | 'evaluation',
    filterValue: string
  ): Promise<{ allowed: boolean; currentCount: number; max: number }> => {
    const max = 2;
    try {
      return await getZaloSendCount({
        studentId,
        classId: classData?.id || classId || '',
        type,
        context: filterValue,
        max,
      });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[Zalo] Rate limit check failed:', err);
      return { allowed: true, currentCount: 0, max };
    }
  };

  const handleAbsentMarked = useCallback(
    (event: AbsentMarkedEvent) => {
      const student = students.find((s) => s.id === event.studentId);
      if (student?.contact && isValidVNPhone(student.contact)) {
        setZaloConfirmData(event);
      }
    },
    [students]
  );

  const handleZaloConfirm = async () => {
    if (!zaloConfirmData || !classData || !profile || isSendingZalo) return;
    const student = students.find((s) => s.id === zaloConfirmData.studentId);
    if (!student) {
      setZaloConfirmData(null);
      return;
    }

    setIsSendingZalo(true);
    const toastId = toast.loading(t.zaloNotifications.sendingZalo);
    try {
      const rateLimit = await checkZaloRateLimit(student.id, 'absence', zaloConfirmData.date);
      if (!rateLimit.allowed) {
        toast.error(
          t.zaloNotifications.rateLimitExceeded
            .replace('{name}', student.name)
            .replace('{max}', String(rateLimit.max)),
          { id: toastId }
        );
        setZaloConfirmData(null);
        return;
      }

      const result = await sendZaloAbsenceNotification({
        studentId: student.id,
        studentName: student.name,
        studentCode: student.studentId || student.code || '',
        className: classData.name,
        classId: classData.id,
        address: classData.name || 'Nancy English Center',
        teacherId: profile.uid,
        phone: student.contact,
        date: zaloConfirmData.date,
      });

      if (result.success) {
        toast.success(t.zaloNotifications.sentAbsenceSuccess.replace('{name}', student.name), {
          id: toastId,
        });
        setZaloAbsenceCounts((prev) => ({ ...prev, [student.id]: (prev[student.id] || 0) + 1 }));
      } else {
        toast.error(t.zaloNotifications.sendFailed.replace('{error}', result.error || ''), {
          id: toastId,
          duration: 8000,
        });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Zalo notify error:', err);
      toast.error(t.zaloNotifications.sendError, { id: toastId });
    } finally {
      setIsSendingZalo(false);
      setZaloConfirmData(null);
    }
  };

  const sendRankNotificationIfNeeded = async (student: Student, rankValue: unknown) => {
    if (!classData || !profile) return null;
    const rank = normalizeEvaluationRank(rankValue);
    if (!isRankedEvaluation(rank)) return null;

    return await sendZaloRankNotification({
      studentId: student.id,
      classId: classData.id,
    });
  };

  const handleSendZaloEvaluation = async (student: Student, evalData: EvaluationFormData) => {
    if (!classData || !profile || isSendingZalo) return false;
    if (!student.contact || !isValidVNPhone(student.contact)) {
      toast.error(t.zaloNotifications.invalidPhone);
      return false;
    }

    setIsSendingZalo(true);
    const toastId = toast.loading(t.zaloNotifications.sendingEval);
    try {
      const rateLimit = await checkZaloRateLimit(student.id, 'evaluation', classData.id);
      if (!rateLimit.allowed) {
        toast.error(
          t.zaloNotifications.rateLimitEvalExceeded
            .replace('{name}', student.name)
            .replace('{max}', String(rateLimit.max)),
          { id: toastId }
        );
        return;
      }

      const result = await sendZaloEvaluationNotification({
        studentId: student.id,
        classId: classData.id,
      });

      if (result.success) {
        const rankResult = await sendRankNotificationIfNeeded(student, evalData.rank);
        if (rankResult && !rankResult.success) {
          toast.error(
            t.zaloNotifications.rankSendFailed.replace('{error}', rankResult.error || ''),
            { duration: 8000 }
          );
        }
        if (result.tuitionSent === false) {
          toast.error(
            t.zaloNotifications.evalTuitionFailed.replace('{error}', result.tuitionError || ''),
            {
              id: toastId,
              duration: 8000,
            }
          );
        } else if (result.tuitionSent) {
          toast.success(t.zaloNotifications.evalAndTuitionSent.replace('{name}', student.name), {
            id: toastId,
          });
        } else {
          toast.success(t.zaloNotifications.evalSent.replace('{name}', student.name), {
            id: toastId,
          });
        }
        return true;
      } else {
        toast.error(t.zaloNotifications.evalSendFailed.replace('{error}', result.error || ''), {
          id: toastId,
          duration: 8000,
        });
        return false;
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Zalo eval error:', err);
      toast.error(t.zaloNotifications.evalSendError, { id: toastId });
      return false;
    } finally {
      setIsSendingZalo(false);
    }
  };

  const handleSendZaloFromCard = (student: Student, evaluation: Evaluation) => {
    if (!classData || !profile) return;
    if (!student.contact || !isValidVNPhone(student.contact)) {
      toast.error(t.zaloNotifications.invalidPhone);
      return;
    }
    setZaloEvalConfirmData({ student, evaluation });
  };

  const handleZaloEvalConfirm = async () => {
    if (!zaloEvalConfirmData || !classData || !profile || isSendingZalo) return;
    const { student, evaluation } = zaloEvalConfirmData;

    setIsSendingZalo(true);
    const toastId = toast.loading(t.zaloNotifications.sendingEval);
    try {
      const rateLimit = await checkZaloRateLimit(student.id, 'evaluation', classData.id);
      if (!rateLimit.allowed) {
        toast.error(
          t.zaloNotifications.rateLimitEvalExceeded
            .replace('{name}', student.name)
            .replace('{max}', String(rateLimit.max)),
          { id: toastId }
        );
        setZaloEvalConfirmData(null);
        return;
      }

      const result = await sendZaloEvaluationNotification({
        studentId: student.id,
        classId: classData.id,
      });

      if (result.success) {
        const rankResult = await sendRankNotificationIfNeeded(student, evaluation.rank);
        if (rankResult && !rankResult.success) {
          toast.error(
            t.zaloNotifications.rankSendFailed.replace('{error}', rankResult.error || ''),
            { duration: 8000 }
          );
        }
        if (result.tuitionSent === false) {
          toast.error(
            t.zaloNotifications.evalTuitionFailed.replace('{error}', result.tuitionError || ''),
            {
              id: toastId,
              duration: 8000,
            }
          );
        } else if (result.tuitionSent) {
          toast.success(t.zaloNotifications.evalAndTuitionSent.replace('{name}', student.name), {
            id: toastId,
          });
        } else {
          toast.success(t.zaloNotifications.evalSent.replace('{name}', student.name), {
            id: toastId,
          });
        }
      } else {
        toast.error(t.zaloNotifications.evalSendFailed.replace('{error}', result.error || ''), {
          id: toastId,
          duration: 8000,
        });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Zalo eval error:', err);
      toast.error(t.zaloNotifications.evalSendError, { id: toastId });
    } finally {
      setIsSendingZalo(false);
      setZaloEvalConfirmData(null);
    }
  };

  useEffect(() => {
    if (!notifyAbsenceDate || !classId) return;
    let cancelled = false;
    Promise.all(
      students.map(async (student) => {
        const count = await getZaloSendCount({
          studentId: student.id,
          classId,
          type: 'absence',
          context: notifyAbsenceDate,
          max: 2,
        });
        return [student.id, count.currentCount] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        entries.forEach(([studentId, count]) => {
          counts[studentId] = count;
        });
        setZaloAbsenceCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setZaloAbsenceCounts({});
      });
    return () => {
      cancelled = true;
    };
  }, [notifyAbsenceDate, classId, students]);

  return {
    zaloConfirmData,
    setZaloConfirmData,
    zaloEvalConfirmData,
    setZaloEvalConfirmData,
    isSendingZalo,
    zaloAbsenceCounts,
    handleAbsentMarked,
    handleZaloConfirm,
    handleSendZaloEvaluation,
    handleSendZaloFromCard,
    handleZaloEvalConfirm,
  };
}

export async function createZaloBulkNotificationJob(input: {
  classId: string;
  type: 'evaluation' | 'rank_achievement' | 'tuition_notice';
  items: { studentId: string; ledgerId?: string }[];
}) {
  return apiRequest<{
    success: boolean;
    jobId: string;
    requestedCount: number;
    processedCount: number;
    successCount: number;
    failureCount: number;
    results: {
      studentId: string;
      success: boolean;
      messageId?: string;
      error?: string;
      errorCode?: string;
      alreadySent?: boolean;
    }[];
  }>('/api/v1/zalo/bulk-notification-job', {
    method: 'POST',
    body: input,
  });
}
