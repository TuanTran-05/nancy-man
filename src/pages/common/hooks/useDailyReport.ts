import { useState } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/auth/sessionAuth';
import { apiRequest } from '../../../lib/api/apiClient';
import { getVNTodayStr, formatVN } from '../../../lib/core/utils';
import { exportDailyReportPDF } from '../../../lib/exports/exportDailyReportPDF';

export function useDailyReport({
  classId,
  dailyReports,
  todaySessionSummary,
  setDailyReports,
  dailyReportPdfRef,
  setIsExporting,
  classData,
  t,
  attendanceData,
  classroomStudents,
}: {
  classId: string | undefined;
  dailyReports: any[];
  todaySessionSummary: any;
  setDailyReports: React.Dispatch<React.SetStateAction<any[]>>;
  dailyReportPdfRef: React.RefObject<HTMLDivElement>;
  setIsExporting: React.Dispatch<React.SetStateAction<boolean>>;
  classData: any;
  t: any;
  attendanceData: any[];
  classroomStudents: any[];
}) {
  const todayStr = getVNTodayStr();
  const [isDailyReportModalOpen, setIsDailyReportModalOpen] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [dailyReportFormData, setDailyReportFormData] = useState({
    date: todayStr,
    generalComment: '',
    additionalNotes: '',
  });

  const handleSaveDailyReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !auth.currentUser || isSavingReport) return;

    if (
      dailyReportFormData.date === todayStr &&
      todaySessionSummary.pendingAttendanceCount > 0 &&
      !window.confirm(
        t.pendingAttendance.replace('{count}', String(todaySessionSummary.pendingAttendanceCount))
      )
    ) {
      return;
    }

    setIsSavingReport(true);
    try {
      const existingReport = dailyReports.find((r) => r.date === dailyReportFormData.date);
      const localData = {
        classId: classId,
        teacherId: auth.currentUser!.uid,
        date: dailyReportFormData.date,
        generalComment: dailyReportFormData.generalComment,
        additionalNotes: dailyReportFormData.additionalNotes,
        updatedAt: new Date().toISOString(),
      };

      const result = await apiRequest<{ id: string }>('/api/v1/edu/evaluation-save-daily-report', {
        method: 'POST',
        body: {
          classId,
          date: dailyReportFormData.date,
          generalComment: dailyReportFormData.generalComment,
          additionalNotes: dailyReportFormData.additionalNotes,
        },
      });

      if (existingReport) {
        setDailyReports((prev) =>
          prev.map((report) =>
            report.id === existingReport.id
              ? { ...report, ...localData, id: existingReport.id }
              : report
          )
        );
      } else {
        setDailyReports((prev) => [...prev, { id: result.id, ...localData }]);
      }

      toast.success(t.dailyReportSaved);
      setIsDailyReportModalOpen(false);
    } catch (err) {
      console.error('Error saving daily report:', err);
      toast.error(t.dailyReportError);
    } finally {
      setIsSavingReport(false);
    }
  };

  const handleExportDailyReportPDF = async () => {
    await exportDailyReportPDF(
      dailyReportPdfRef,
      setIsExporting,
      classData,
      dailyReportFormData.date
    );
  };

  const openDailyReportModal = (targetDate: string = todayStr) => {
    const existingReport = dailyReports.find((report) => report.date === targetDate);
    const targetAttendance = attendanceData.filter((attendance) => attendance.date === targetDate);
    const absentStudents = classroomStudents.filter(
      (student) =>
        targetAttendance.find((attendance) => attendance.studentId === student.id)?.status ===
        'absent'
    );
    const lateStudents = classroomStudents.filter(
      (student) =>
        targetAttendance.find((attendance) => attendance.studentId === student.id)?.status ===
        'late'
    );

    const defaultGeneralComment =
      absentStudents.length === 0 && lateStudents.length === 0
        ? t.sessionStable.replace('{date}', formatVN(targetDate, 'dd/MM/yyyy'))
        : t.sessionCompleted.replace('{date}', formatVN(targetDate, 'dd/MM/yyyy'));

    const defaultAdditionalNotes = [
      absentStudents.length > 0
        ? t.absentStudents.replace(
            '{students}',
            absentStudents.map((student) => student.name).join(', ')
          )
        : '',
      lateStudents.length > 0
        ? t.lateStudents.replace(
            '{students}',
            lateStudents.map((student) => student.name).join(', ')
          )
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    setDailyReportFormData({
      date: targetDate,
      generalComment: existingReport?.generalComment || defaultGeneralComment,
      additionalNotes: existingReport?.additionalNotes || defaultAdditionalNotes,
    });
    setIsDailyReportModalOpen(true);
  };

  return {
    isDailyReportModalOpen,
    setIsDailyReportModalOpen,
    isSavingReport,
    dailyReportFormData,
    setDailyReportFormData,
    handleSaveDailyReport,
    handleExportDailyReportPDF,
    openDailyReportModal,
  };
}
