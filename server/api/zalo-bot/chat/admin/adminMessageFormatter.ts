import { ZALO_BOT_SENSITIVE_CONTENT_MARKER } from '../../../../../shared/zaloBot.js';
import type {
  AdminCandidateItem,
  AdminDataQuality,
  AdminQueryResult,
  AdminTuitionStatus,
} from './adminChatTypes.js';

export function formatVND(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Chưa có dữ liệu';
  return `${amount.toLocaleString('vi-VN')} đ`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return 'Chưa có dữ liệu';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatPlacementStatus(status: string | null | undefined): string {
  switch (status) {
    case 'studying':
      return 'Đang học';
    case 'trial':
      return 'Học thử';
    case 'on_leave':
      return 'Bảo lưu';
    case 'waiting_for_placement':
      return 'Chờ xếp lớp';
    case 'inactive':
      return 'Tạm ngưng';
    default:
      return status || 'Chưa xác định';
  }
}

export function formatTuitionStatus(status: AdminTuitionStatus): string {
  switch (status) {
    case 'paid':
      return 'Đã đóng đủ (100%)';
    case 'partial':
      return 'Đang đóng dở dang (còn nợ)';
    case 'overdue':
      return 'Quá hạn đóng học phí';
    case 'unpaid':
      return 'Chưa đóng học phí';
    case 'missing_ledger':
      return 'Chưa có bảng học phí (chưa tạo ledger)';
    case 'waived':
      return 'Được miễn giảm 100% (Học bổng / Miễn chính sách)';
    default:
      return status;
  }
}

export type FormattedAdminMessage = {
  text: string;
  suggestedPrompts: string[];
  isSensitive: boolean;
};

const SENSITIVE_RESULT_KINDS = new Set<AdminQueryResult['kind']>([
  'directory_lookup',
  'student_phone',
  'student_tuition',
  'center_finance',
  'class_course_period',
  'class_tuition',
  'class_tuition_ranking',
  'teacher_payroll',
  'student_academic',
]);

function qualityPrefix(quality: AdminDataQuality | undefined): string {
  return quality?.status === 'degraded'
    ? '⚠️ Dữ liệu dưới đây chưa đầy đủ hoặc đang được cập nhật.\n\n'
    : '';
}

/**
 * Formats structured AdminQueryResult into user-friendly Vietnamese text for Zalo.
 */
export function formatAdminQueryResult(
  result: AdminQueryResult,
  options: { isSensitiveViewer?: boolean } = {}
): FormattedAdminMessage {
  const isSensitiveViewer = options.isSensitiveViewer !== false;
  const quality = 'quality' in result ? result.quality : undefined;
  const prefix = qualityPrefix(quality);

  if (quality?.status === 'failed') {
    return {
      text: '⚠️ Chưa thể xác nhận dữ liệu từ nguồn canonical. Vui lòng thử lại sau; hệ thống không trả số 0 thay cho dữ liệu thiếu.',
      suggestedPrompts: ['Thử lại yêu cầu vừa rồi'],
      isSensitive: SENSITIVE_RESULT_KINDS.has(result.kind),
    };
  }

  switch (result.kind) {
    case 'directory_lookup': {
      const st = result.student;
      const lines = [
        `👤 **THÔNG TIN HỌC SINH**`,
        `• Họ và tên: **${st.fullName}** (Mã: ${st.studentCode || 'Chưa có'})`,
        `• Lớp hiện tại: ${st.currentClassName || 'Chưa xếp lớp'}`,
        `• Giáo viên: ${st.teacherName || 'Chưa phân công'}`,
        `• Trạng thái: **${formatPlacementStatus(st.placementStatus)}**`,
      ];

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Học phí của ${st.fullName} đóng chưa?`,
          `Số điện thoại phụ huynh ${st.fullName}`,
          `Tình hình học tập của ${st.fullName}`,
        ],
        isSensitive: true,
      };
    }

    case 'student_phone': {
      const st = result.student;
      let phoneDisplay = st.phone || 'Chưa cập nhật số điện thoại';
      if (!isSensitiveViewer && st.phone) {
        phoneDisplay = `${st.phone.slice(0, 3)}****${st.phone.slice(-3)}`;
      }

      const phoneTag = isSensitiveViewer
        ? phoneDisplay
        : `${ZALO_BOT_SENSITIVE_CONTENT_MARKER}${phoneDisplay}${ZALO_BOT_SENSITIVE_CONTENT_MARKER}`;

      const lines = [
        `📞 **SỐ ĐIỆN THOẠI PHỤ HUYNH**`,
        `• Học sinh: **${st.fullName}** (Mã: ${st.studentCode || 'Chưa có'})`,
        `• Lớp: ${st.className || 'Chưa xếp lớp'}`,
        `• SĐT liên hệ: **${phoneTag}**`,
      ];

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [`Học phí của ${st.fullName} thế nào?`, `Điểm thi của ${st.fullName}`],
        isSensitive: true,
      };
    }

    case 'student_tuition': {
      const st = result.student;
      const lines = [
        `💰 **TÌNH HÌNH HỌC PHÍ HỌC SINH**`,
        `• Học sinh: **${st.fullName}** (${st.className || 'Chưa xếp lớp'})`,
        `• Khóa học: ${result.courseLabel || 'Khóa hiện tại'}`,
        `• Trạng thái: **${formatTuitionStatus(result.paymentStatus)}**`,
      ];

      if (result.paymentStatus !== 'missing_ledger') {
        lines.push(
          `• Học phí niêm yết: ${formatVND(result.grossBilled)}`,
          `• Giảm trừ/Học bổng: ${formatVND(result.discountTotal)}`,
          `• Phải thu ròng: **${formatVND(result.netBilled)}**`,
          `• Đã thanh toán: **${formatVND(result.paidTotal)}**`,
          `• Còn nợ: **${formatVND(result.outstandingTotal)}**`
        );
        if (result.dueDate) {
          lines.push(`• Hạn đóng: ${result.dueDate}`);
        }
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Số điện thoại của ${st.fullName}`,
          `Tình hình học tập của ${st.fullName}`,
          `Xem học phí lớp ${st.className || ''}`,
        ],
        isSensitive: true,
      };
    }

    case 'center_headcount': {
      const b = result.breakdown;
      const lines = [
        `👥 **BÁO CÁO SĨ SỐ TOÀN TRUNG TÂM**`,
        `• Tổng học viên canonical: **${result.totalCanonical} em**`,
        `─────────────────────`,
        `• 🟢 Đang học chính thức: **${b.studying}** em`,
        `• 🟡 Đang học thử: **${b.trial}** em`,
        `• 🔵 Bảo lưu: **${b.on_leave}** em`,
        `• 🟠 Chờ xếp lớp: **${b.waiting_for_placement}** em`,
        `• ⚪ Tạm ngưng/Đã nghỉ: **${b.inactive}** em`,
      ];

      if (result.quality.status === 'degraded') {
        lines.push(`\n*(Dữ liệu tổng hợp có thể đang được cập nhật lại)*`);
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Doanh thu tháng này của trung tâm`,
          `Lớp nào còn nợ học phí nhiều nhất?`,
          `Tổng lương giáo viên tháng này`,
        ],
        isSensitive: false,
      };
    }

    case 'center_finance': {
      const lines = [
        `📊 **BÁO CÁO TÀI CHÍNH (${result.period.displayLabel})**`,
        `• Doanh thu dự kiến (Phải thu ròng): **${formatVND(result.netBilled)}**`,
        `• Tiền thực thu vào (Cash In): **${formatVND(result.cashIn)}**`,
        `• Tiền thực chi ra (Cash Out): **${formatVND(result.cashOut)}**`,
        `• Dòng tiền ròng: **${formatVND(result.netCashFlow)}**`,
        `• Giảm trừ thương mại: ${formatVND(result.discount)}`,
        `• Miễn giảm chính sách: ${formatVND(result.waiver)}`,
        `• Công nợ còn lại: **${formatVND(result.outstanding)}**`,
      ];

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Xếp hạng các lớp nợ học phí nhiều nhất`,
          `Tổng lương giáo viên tháng này`,
          `Sĩ số học sinh toàn trung tâm`,
        ],
        isSensitive: true,
      };
    }

    case 'class_course_period': {
      const lines = [
        `📅 **THÔNG TIN KHÓA HỌC LỚP ${result.className}**`,
        `• Giáo viên: ${result.teacherName || 'Chưa phân công'}`,
        `• Khóa hiện tại: **${result.courseLabel}**`,
        `• Ngày bắt đầu: **${result.startDate || 'Chưa thiết lập'}**`,
        `• Ngày kết thúc: **${result.endDate || 'Chưa thiết lập'}**`,
      ];

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Học phí lớp ${result.className} thu được bao nhiêu rồi?`,
          `Lớp nào nợ nhiều nhất?`,
        ],
        isSensitive: true,
      };
    }

    case 'class_tuition': {
      const lines = [
        `🏫 **ĐỐI SOÁT HỌC PHÍ LỚP ${result.className}**`,
        `• Giáo viên: ${result.teacherName || 'Chưa phân công'} (${result.courseLabel})`,
        `• Sĩ số: **${result.studentCount} học sinh**`,
        `• Phải thu ròng: **${formatVND(result.netDueTotal)}**`,
        `• Đã thu: **${formatVND(result.paidTotal)}**`,
        `• Còn nợ: **${formatVND(result.outstandingTotal)}**`,
      ];

      if (result.missingLedgerCount > 0) {
        lines.push(`⚠️ Cảnh báo: Có **${result.missingLedgerCount} em** chưa tạo bảng học phí.`);
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Thời gian khóa học lớp ${result.className}`,
          `Xếp hạng lớp nợ học phí nhiều nhất`,
          `Doanh thu toàn trung tâm tháng này`,
        ],
        isSensitive: true,
      };
    }

    case 'class_tuition_ranking': {
      const criterionTitle =
        result.criterion === 'highest_outstanding'
          ? 'CÁC LỚP NỢ HỌC PHÍ NHIỀU NHẤT'
          : result.criterion === 'nearly_paid'
            ? 'CÁC LỚP SẮP THU XONG HỌC PHÍ (>=90%)'
            : 'CÁC LỚP ĐÃ HOÀN THÀNH THU HỌC PHÍ (100%)';

      const lines = [`🏆 **BẢNG XẾP HẠNG: ${criterionTitle}**`];

      if (result.rows.length === 0) {
        lines.push(`Hiện chưa có lớp nào thuộc nhóm này.`);
      } else {
        result.rows.forEach((r, idx) => {
          const detail =
            result.criterion === 'highest_outstanding'
              ? `Nợ: **${formatVND(r.outstandingTotal)}** (Đã thu: ${formatPercent(r.paidRatio)})`
              : result.criterion === 'nearly_paid'
                ? `Đã thu: **${formatPercent(r.paidRatio)}** (Còn nợ: ${formatVND(r.outstandingTotal)})`
                : `Đã thu: **${formatVND(r.paidTotal)}** (100%)`;

          lines.push(
            `${idx + 1}. **${r.className}** (${r.teacherName || 'Chưa gán GV'}): ${detail}`
          );
        });

        if (result.omittedCount > 0) {
          lines.push(`*(và ${result.omittedCount} lớp khác)*`);
        }
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          result.rows[0]
            ? `Xem học phí lớp ${result.rows[0].className}`
            : `Báo cáo tài chính tháng này`,
          `Doanh thu trung tâm tháng này`,
          `Sĩ số học sinh toàn trung tâm`,
        ],
        isSensitive: true,
      };
    }

    case 'teacher_payroll': {
      if (result.teacherName) {
        const lines = [
          `👨‍🏫 **LƯƠNG DỰ TÍNH GIÁO VIÊN: ${result.teacherName}**`,
          `• Kỳ lương: **${result.period.displayLabel}**`,
          `• Tổng số buổi dạy: **${result.totalSessions} buổi**`,
          `• Lương phát sinh: **${formatVND(result.accruedSalary)}**`,
        ];

        if (result.classBreakdown && result.classBreakdown.length > 0) {
          lines.push(`\nChi tiết theo lớp:`);
          result.classBreakdown.forEach((c) => {
            lines.push(`• Lớp ${c.className}: ${c.sessionCount} buổi (${formatVND(c.salary)})`);
          });
        }

        return {
          text: prefix + lines.join('\n'),
          suggestedPrompts: [
            `Tổng lương giáo viên toàn trung tâm ${result.period.displayLabel}`,
            `Báo cáo tài chính trung tâm ${result.period.displayLabel}`,
          ],
          isSensitive: true,
        };
      }

      const lines = [
        `👨‍🏫 **TỔNG LƯƠNG GIÁO VIÊN TOÀN TRUNG TÂM**`,
        `• Kỳ lương: **${result.period.displayLabel}**`,
        `• Tổng số buổi dạy: **${result.totalSessions} buổi**`,
        `• Tổng lương phát sinh: **${formatVND(result.accruedSalary)}**`,
      ];

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Báo cáo tài chính ${result.period.displayLabel}`,
          `Lớp nào nợ học phí nhiều nhất?`,
        ],
        isSensitive: true,
      };
    }

    case 'student_academic': {
      const st = result.student;
      const lines = [
        `📚 **TÌNH HÌNH HỌC TẬP HỌC SINH**`,
        `• Học sinh: **${st.fullName}** (${st.className || 'Chưa xếp lớp'})`,
      ];

      if (result.evaluations.length === 0) {
        lines.push('• Đánh giá: Chưa có bản ghi đánh giá hợp lệ.');
      } else {
        lines.push('\n**Đánh giá gần nhất:**');
        result.evaluations.slice(0, 3).forEach((evaluation) => {
          const type = evaluation.type === 'final' ? 'Cuối kỳ' : 'Giữa kỳ';
          const score = evaluation.score == null ? 'Chưa chấm' : String(evaluation.score);
          const rank = evaluation.rank ? `, xếp loại ${evaluation.rank}` : '';
          lines.push(
            `• ${type} – ${evaluation.termLabel}${evaluation.date ? ` (${evaluation.date})` : ''}: **${score}**${rank}`
          );
          if (evaluation.strengths.length > 0) {
            lines.push(`  Nhận xét: _${evaluation.strengths.slice(0, 2).join('; ')}_`);
          }
          if (evaluation.improvements.length > 0) {
            lines.push(`  Cần cải thiện: _${evaluation.improvements.slice(0, 2).join('; ')}_`);
          }
        });
      }

      if (result.assignments.length > 0) {
        lines.push('\n**Bài tập đã chấm gần nhất:**');
        result.assignments.slice(0, 3).forEach((assignment) => {
          lines.push(
            `• ${assignment.title}: **${assignment.score == null ? 'Chưa chấm' : `${assignment.score}/${assignment.maxScore ?? 100}`}**`
          );
        });
      }

      if (result.attendanceSummary) {
        lines.push(
          `\n• Chuyên cần: Có mặt **${result.attendanceSummary.presentSessions}/${result.attendanceSummary.totalSessions}** buổi; vắng ${result.attendanceSummary.absentSessions} buổi.`
        );
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [
          `Học phí của ${st.fullName} đóng chưa?`,
          `Số điện thoại của ${st.fullName}`,
        ],
        isSensitive: true,
      };
    }

    case 'zalo_operations': {
      const lines = [
        `⚙️ **TÌNH HÌNH VẬN HÀNH ZALO BOT – ${result.period.displayLabel}**`,
        `• Tin nhắn đã gửi thành công: **${result.messages.sent} tin**`,
        `• Tin nhắn gửi thất bại: **${result.messages.failed} tin**`,
        `• Pending quá hạn: **${result.backlogs.stalePending} tin**`,
        `• Processing quá hạn: **${result.backlogs.staleProcessing} tin**`,
        `• Hàng đợi retry: **${result.backlogs.retryQueue} tin**`,
        `• Tài khoản đã liên kết Zalo: **${result.links.active} tài khoản**`,
        `• Liên kết đã tắt/cần liên kết lại/chờ xử lý: **${result.links.disabled}/${result.links.needsRelink}/${result.links.pendingCount}**`,
      ];

      if (result.topErrors.length > 0) {
        lines.push(
          `• Lỗi phổ biến: ${result.topErrors.map((item) => `${item.errorCode} (${item.count})`).join(', ')}`
        );
      }

      return {
        text: prefix + lines.join('\n'),
        suggestedPrompts: [`Sĩ số học sinh toàn trung tâm`, `Báo cáo doanh thu tháng này`],
        isSensitive: false,
      };
    }

    default:
      return {
        text: 'Đã hoàn tất xử lý yêu cầu.',
        suggestedPrompts: ['Báo cáo tài chính tháng này', 'Sĩ số toàn trung tâm'],
        isSensitive: false,
      };
  }
}

/**
 * Formats disambiguation candidates list when multiple entities match.
 */
export function formatDisambiguationMessage(
  candidates: AdminCandidateItem[],
  omittedCount = 0
): FormattedAdminMessage {
  const lines = [
    `🔍 **Tìm thấy ${candidates.length + omittedCount} học sinh trùng khớp. Bạn muốn xem thông tin của em nào?**\n`,
  ];

  candidates.forEach((c, idx) => {
    const classInfo = c.className ? ` - Lớp: ${c.className}` : '';
    const teacherInfo = c.teacherName ? ` (GV: ${c.teacherName})` : '';
    const codeInfo = c.code ? ` [Mã: ${c.code}]` : '';
    lines.push(`${idx + 1}. **${c.fullName}**${codeInfo}${classInfo}${teacherInfo}`);
  });

  if (omittedCount > 0) {
    lines.push(`\n*(và ${omittedCount} học sinh khác)*`);
  }

  lines.push(
    `\n💡 *Gợi ý: Bạn có thể nhắn "em thứ 1", "bạn thứ 2", hoặc chỉ định thêm tên lớp / giáo viên.*`
  );

  const suggestedPrompts = candidates.slice(0, 3).map((_, i) => `Em thứ ${i + 1}`);

  return {
    text: lines.join('\n'),
    suggestedPrompts,
    isSensitive: true,
  };
}

/**
 * Formats friendly not found message.
 */
export function formatNotFoundMessage(hint: string, type = 'học sinh'): FormattedAdminMessage {
  return {
    text: `Không tìm thấy thông tin ${type} nào phù hợp với **"${hint}"**.\n\n💡 *Vui lòng kiểm tra lại tên, mã học viên hoặc tên lớp.*`,
    suggestedPrompts: [`Danh sách sĩ số toàn trung tâm`, `Báo cáo tài chính tháng này`],
    isSensitive: true,
  };
}
