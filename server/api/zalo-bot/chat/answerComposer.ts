import type { ZaloBotChatAnswer } from './chatTypes.js';

/** Giới hạn cứng của Zalo Bot sendMessage. Xem server/api/zalo-bot/botClient.ts:44. */
export const ZALO_BOT_CHAT_MAX_TEXT = 2000;

const TRUNCATION_SUFFIX = '\n…(đã rút gọn)';

function formatDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

function formatDayMonthYear(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function clamp(text: string): string {
  if (text.length <= ZALO_BOT_CHAT_MAX_TEXT) return text;
  return text.slice(0, ZALO_BOT_CHAT_MAX_TEXT - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function composeBody(answer: ZaloBotChatAnswer): string {
  switch (answer.kind) {
    case 'student_count': {
      const extras: string[] = [];
      if (answer.onLeave > 0) extras.push(`${answer.onLeave} bảo lưu`);
      if (answer.trial > 0) extras.push(`${answer.trial} học thử`);
      const head = `Lớp ${answer.className} — ${answer.active} học sinh đang học`;
      return extras.length > 0 ? `${head}\n(${extras.join(', ')})` : head;
    }

    case 'student_list': {
      const lines = answer.names.map((name, index) => `${index + 1}. ${name}`);
      const total = answer.names.length + answer.omitted;
      const head = `Lớp ${answer.className} — ${total} học sinh:`;
      const tail = answer.omitted > 0 ? `\n…còn ${answer.omitted} em nữa` : '';
      return `${head}\n${lines.join('\n')}${tail}`;
    }

    case 'class_end_date':
      return answer.endDate
        ? `Lớp ${answer.className} dự kiến kết khóa ngày ${formatDayMonthYear(answer.endDate)}.`
        : `Lớp ${answer.className} hiện chưa có ngày kết khóa.`;

    case 'attendance_today': {
      if (answer.classes.length === 0) {
        return `Hôm nay bạn không có lớp nào cần điểm danh.`;
      }
      const lines = answer.classes.map((row) =>
        row.missing === 0
          ? `• ${row.className}: đã điểm danh đủ ${row.marked}/${row.eligible}`
          : `• ${row.className}: còn ${row.missing} em chưa điểm danh (${row.marked}/${row.eligible})`
      );
      return `Điểm danh ngày ${formatDayMonth(answer.date)}:\n${lines.join('\n')}`;
    }

    case 'my_todo': {
      if (
        answer.attendance.length === 0 &&
        answer.courseClosing.length === 0 &&
        answer.printRequests.length === 0
      ) {
        return 'Bạn không còn việc nào cần xử lý.';
      }
      const sections: string[] = [];
      if (answer.attendance.length > 0) {
        const lines = answer.attendance.map(
          (row) => `• ${row.className}: còn ${row.missingStudentCount} em chưa điểm danh`
        );
        sections.push(`Điểm danh chưa xong:\n${lines.join('\n')}`);
      }
      if (answer.courseClosing.length > 0) {
        const lines = answer.courseClosing.map(
          (row) => `• ${row.className}: kết thúc ${formatDayMonth(row.endDate)}`
        );
        sections.push(`Lớp sắp kết thúc:\n${lines.join('\n')}`);
      }
      if (answer.printRequests.length > 0) {
        const lines = answer.printRequests.map(
          (row) =>
            `• ${row.className} — ${row.teacherName}: ${row.fileCount} file, ${row.totalCopies} bản, cần ${formatDayMonth(row.neededDate)}`
        );
        sections.push(`Yêu cầu in đang chờ:\n${lines.join('\n')}`);
      }
      return sections.join('\n\n');
    }

    case 'class_not_found':
      return `Không tìm thấy lớp nào tên «${answer.hint}» trong các lớp của bạn.`;

    case 'class_ambiguous':
      return `Bạn hỏi lớp nào: ${answer.candidates.join(', ')}?`;

    case 'unsupported':
      return [
        'Tôi trả lời được bốn việc:',
        '• sĩ số và danh sách học sinh của một lớp',
        '• ngày kết khóa của một lớp',
        '• điểm danh hôm nay',
        '• việc cần xử lý của bạn',
      ].join('\n');

    case 'rate_limited':
      return 'Bạn đã hỏi khá nhiều trong giờ qua, thử lại sau ít phút giúp tôi.';

    case 'error':
      return 'Hiện chưa trả lời được, bạn thử lại giúp tôi.';
  }
}

export function composeZaloBotChatAnswer(answer: ZaloBotChatAnswer): string {
  return clamp(composeBody(answer));
}
