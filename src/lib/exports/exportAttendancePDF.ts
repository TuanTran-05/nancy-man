import type { Class, Attendance, SafeStudent } from '../../types';
import { formatVN, toVNDateStr } from '../core/utils';
import { buildAttendancePdfRows } from './attendancePdfRows';
import type { AttendanceTermScope } from '../attendance/classAttendanceEligibility';

export async function exportAttendanceReport(
  classData: Class | null,
  coursePeriod: { start?: string | null; end?: string | null },
  holidays: string[] | null | undefined,
  students: SafeStudent[],
  attendanceData: Attendance[],
  tPDF: {
    title: string;
    classLabel: string;
    teacherLabel: string;
    openingDate: string;
    closingDate: string;
    fullName: string;
    dob: string;
    contact: string;
    presentCode?: string;
    absentCode?: string;
    lateCode?: string;
    notEnrolledCode?: string;
    onLeaveCode?: string;
    notEnrolledLegend?: string;
    onLeaveLegend?: string;
  },
  teacherDisplayName: string | null | undefined,
  explicitDates?: string[]
) {
  if (!classData) return;

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF('l', 'mm', 'a4');

  const removeAccents = (str: string) => {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  };

  const periodStart = coursePeriod.start || classData.startDate;
  const periodEnd = coursePeriod.end || classData.endDate;

  let exportDateStrs: string[] = [];
  if (explicitDates && explicitDates.length > 0) {
    exportDateStrs = explicitDates;
  } else {
    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      if (classData.daysOfWeek?.includes(cursor.getDay())) {
        const isoStr = toVNDateStr(cursor);
        if (!holidays?.includes(isoStr)) {
          exportDateStrs.push(isoStr);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const termScope: AttendanceTermScope = {
    classId: classData.id,
    termStart: periodStart,
    termEnd: periodEnd || null,
  };

  const codes = {
    present: tPDF.presentCode || 'P',
    absent: tPDF.absentCode || 'A',
    late: tPDF.lateCode || 'L',
    notEnrolled: tPDF.notEnrolledCode || 'CNI',
    onLeave: tPDF.onLeaveCode || 'TN',
  };

  const legendLabels = {
    notEnrolled: tPDF.notEnrolledLegend || 'CNI = Chua nhap hoc',
    onLeave: tPDF.onLeaveLegend || 'TN = Tam nghi',
  };

  const { rows, legend } = buildAttendancePdfRows({
    students: students as any,
    dates: exportDateStrs,
    attendance: attendanceData,
    termScope,
    codes,
    legendLabels,
  });

  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(removeAccents(tPDF.title), pageW / 2, 16, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(removeAccents(`${tPDF.classLabel}: ${classData.name}`), 14, 26);
  doc.text(removeAccents(`${tPDF.teacherLabel}: ${teacherDisplayName || 'N/A'}`), 14, 33);
  doc.text(removeAccents(`${tPDF.openingDate}: ${formatVN(periodStart, 'dd/MM/yyyy')}`), 14, 40);
  doc.text(removeAccents(`${tPDF.closingDate}: ${formatVN(periodEnd, 'dd/MM/yyyy')}`), 14, 47);

  doc.setFontSize(9);
  doc.text(removeAccents(`Ghi chu: ${legend.join(' | ')}`), 14, 53);

  const exportDateObjs = exportDateStrs.map((d) => new Date(d));

  const head = [
    [
      'STT',
      removeAccents(tPDF.fullName),
      removeAccents(tPDF.dob),
      ...exportDateObjs.map((d) => `${d.getDate()}/${d.getMonth() + 1}`),
      removeAccents(tPDF.contact),
    ],
  ];

  const tableBody = rows.map((r, index) => [
    (index + 1).toString(),
    removeAccents(r.student.name),
    formatVN(r.student.dob, 'dd/MM/yyyy'),
    ...r.cells,
    r.student.contact || '',
  ]);

  const dateColCount = exportDateStrs.length;
  const sttWidth = 10;
  const nameWidth = 35;
  const dobWidth = 22;
  const contactWidth = 25;
  const fixedTotal = sttWidth + nameWidth + dobWidth + contactWidth;
  const availableForDates = pageW - 28 - fixedTotal;
  const dateColWidth =
    dateColCount > 0 ? Math.min(Math.max(availableForDates / dateColCount, 7), 14) : 10;

  const columnStyles: Record<string, any> = {
    '0': { cellWidth: sttWidth, halign: 'center' },
    '1': { cellWidth: nameWidth },
    '2': { cellWidth: dobWidth, halign: 'center' },
  };
  for (let i = 0; i < dateColCount; i++) {
    columnStyles[String(3 + i)] = { cellWidth: dateColWidth, halign: 'center' };
  }
  columnStyles[String(3 + dateColCount)] = { cellWidth: contactWidth };

  autoTable(doc, {
    head,
    body: tableBody,
    startY: 58,
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [41, 65, 122],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    alternateRowStyles: { fillColor: [240, 243, 250] },
    columnStyles,
    margin: { left: 14, right: 14 },
  });

  doc.save(`Attendance_${classData.name}.pdf`);
}
