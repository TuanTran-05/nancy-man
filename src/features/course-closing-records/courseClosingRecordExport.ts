function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function translateClassification(classification?: string): string {
  if (classification === 'excellent') return 'Xuất sắc';
  if (classification === 'good') return 'Tốt';
  if (classification === 'average') return 'Trung bình';
  if (classification === 'weak') return 'Yếu';
  return classification || '';
}

const STATUS_LABELS: Record<string, string> = {
  complete: 'Hoàn tất',
  ready: 'Sẵn sàng',
  pending: 'Đang tạo',
  not_requested: 'Chưa yêu cầu',
  retrying: 'Đang thử lại',
  failed: 'Lỗi',
  missing_evaluation: 'Thiếu nhận xét',
  missing_tuition: 'Thiếu học phí',
};

function translateStatus(status?: string): string {
  if (!status) return '';
  return STATUS_LABELS[status] || status;
}

export function exportCourseClosingRecordsToCsv(
  records: any[],
  role: string,
  month: string
): string {
  const isAccounting = role === 'accounting';

  const headers = isAccounting
    ? [
        'Mã HV',
        'Tên học sinh',
        'Lớp',
        'Giáo viên',
        'Kỳ chốt',
        'Học phí',
        'Hạn nộp',
        'Trạng thái lưu trữ',
      ]
    : [
        'Mã HV',
        'Tên học sinh',
        'Lớp',
        'Giáo viên',
        'Kỳ chốt',
        'Điểm TK',
        'Xếp loại',
        'Học phí',
        'Hạn nộp',
        'TT Nhận xét',
        'TT Học phí',
        'Tổng quan',
      ];

  const rows: string[][] = [headers];

  for (const rec of records) {
    if (isAccounting) {
      rows.push([
        rec.studentCode || '',
        rec.studentName || '',
        rec.className || '',
        rec.teacherName || '',
        rec.closingMonth || month,
        rec.tuitionSnapshot?.amount ? String(rec.tuitionSnapshot.amount) : '',
        rec.tuitionSnapshot?.paymentDueDate || '',
        translateStatus(rec.displayStatus),
      ]);
    } else {
      rows.push([
        rec.studentCode || '',
        rec.studentName || '',
        rec.className || '',
        rec.teacherName || '',
        rec.closingMonth || month,
        rec.evaluationSnapshot?.totalScore !== undefined
          ? String(rec.evaluationSnapshot.totalScore)
          : '',
        translateClassification(rec.evaluationSnapshot?.classification),
        rec.tuitionSnapshot?.amount ? String(rec.tuitionSnapshot.amount) : '',
        rec.tuitionSnapshot?.paymentDueDate || '',
        translateStatus(rec.evaluationDocument?.status),
        translateStatus(rec.tuitionDocument?.status),
        translateStatus(rec.displayStatus),
      ]);
    }
  }

  const csvContent = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  return '\uFEFF' + csvContent;
}
