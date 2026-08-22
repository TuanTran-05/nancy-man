export type SafeAdminErrorResult = {
  code: string;
  safeMessage: string;
  statusCode: number;
};

const KNOWN_SAFE_MESSAGES: Record<string, { message: string; statusCode: number }> = {
  admin_disabled: {
    message: 'Tính năng tra cứu quản trị hiện đang tạm tắt.',
    statusCode: 403,
  },
  unauthorized_admin: {
    message: 'Bạn cần có quyền quản trị viên để thực hiện tra cứu dữ liệu này.',
    statusCode: 403,
  },
  pilot_restricted: {
    message: 'Tài khoản của bạn chưa nằm trong danh sách thử nghiệm tính năng tra cứu này.',
    statusCode: 403,
  },
  capability_disabled: {
    message: 'Chức năng tra cứu này hiện chưa được kích hoạt cho tài khoản của bạn.',
    statusCode: 403,
  },
  deadline_exceeded: {
    message: 'Thời gian xử lý dữ liệu vượt quá giới hạn cho phép. Vui lòng thử lại sau.',
    statusCode: 504,
  },
  rate_limited: {
    message: 'Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng đợi trong giây lát.',
    statusCode: 429,
  },
  query_budget_exceeded: {
    message: 'Dữ liệu quá lớn để tổng hợp trong một câu trả lời. Vui lòng thu hẹp phạm vi câu hỏi.',
    statusCode: 413,
  },
  audit_failed: {
    message: 'Hệ thống ghi nhận nhật ký bảo mật gặp sự cố. Yêu cầu tra cứu đã bị dừng an toàn.',
    statusCode: 503,
  },
  source_unavailable: {
    message: 'Nguồn dữ liệu hiện chưa sẵn sàng hoặc đang trong quá trình cập nhật.',
    statusCode: 503,
  },
  model_unavailable: {
    message: 'Hệ thống phân tích câu hỏi đang bận. Vui lòng thử lại sau giây lát.',
    statusCode: 503,
  },
  invalid_request: {
    message: 'Yêu cầu không hợp lệ hoặc thiếu thông tin cần thiết.',
    statusCode: 400,
  },
  internal_error: {
    message: 'Đã có lỗi xảy ra trong quá trình xử lý. Vui lòng thử lại sau.',
    statusCode: 500,
  },
};

/**
 * Maps any error or exception to a safe, non-leaking code and message.
 * Strips raw exception messages, stack traces, PII, and infrastructure details.
 */
export function toSafeAdminError(err: unknown): SafeAdminErrorResult {
  if (typeof err === 'object' && err !== null) {
    const errorObj = err as Record<string, unknown>;
    const code = typeof errorObj.code === 'string' ? errorObj.code : '';
    if (code && KNOWN_SAFE_MESSAGES[code]) {
      return {
        code,
        safeMessage: KNOWN_SAFE_MESSAGES[code].message,
        statusCode: KNOWN_SAFE_MESSAGES[code].statusCode,
      };
    }

    if (errorObj.name === 'AbortError' || errorObj.message === 'DeadlineExceeded') {
      return {
        code: 'deadline_exceeded',
        safeMessage: KNOWN_SAFE_MESSAGES.deadline_exceeded.message,
        statusCode: 504,
      };
    }
  }

  return {
    code: 'internal_error',
    safeMessage: KNOWN_SAFE_MESSAGES.internal_error.message,
    statusCode: 500,
  };
}
