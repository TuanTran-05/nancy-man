import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { createLogger } from '../logging/logger.js';

type ApiErrorContext = {
  module: string;
  route: string;
  defaultMessage: string;
  defaultStatus?: number;
  metadata?: Record<string, unknown>;
};

type HandledDomainError = Error & {
  statusCode: number;
  errorCode: string;
  courseClosing?: Record<string, unknown>;
};

function isHandledDomainError(err: unknown): err is HandledDomainError {
  return (
    err instanceof Error &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (err as { errorCode?: unknown }).errorCode === 'string' &&
    (!('courseClosing' in err) ||
      (typeof (err as { courseClosing?: unknown }).courseClosing === 'object' &&
        (err as { courseClosing?: unknown }).courseClosing !== null))
  );
}

function getErrorStatus(err: unknown, fallback: number): number {
  if (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  return fallback;
}

function getErrorCode(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 405) return 'method_not_allowed';
  return 'internal_error';
}

export function sendApiError(
  res: ApiResponse,
  statusOrErr: number | unknown,
  errorOrFallback?: string,
  errorCode?: string
) {
  if (typeof statusOrErr === 'number') {
    const status = statusOrErr;
    const error = errorOrFallback || 'Internal server error';
    const code = errorCode || getErrorCode(status);
    return res.status(status).json({ success: false, errorCode: code, error });
  } else {
    const err = statusOrErr;
    const fallbackMessage = errorOrFallback || 'Internal server error';
    const status = getErrorStatus(err, 500);
    const safeMessage =
      status >= 500
        ? fallbackMessage
        : err instanceof Error
          ? err.message || fallbackMessage
          : fallbackMessage;
    const handledDomainError = status < 500 && isHandledDomainError(err) ? err : undefined;
    const code = handledDomainError?.errorCode || (status >= 500 ? 'internal_error' : 'request_error');
    return res.status(status).json({
      success: false,
      errorCode: code,
      error: safeMessage,
      ...(handledDomainError?.courseClosing
        ? { courseClosing: handledDomainError.courseClosing }
        : {}),
    });
  }
}

export function handleApiError(
  req: ApiRequest,
  res: ApiResponse,
  err: unknown,
  context: ApiErrorContext
) {
  const status = getErrorStatus(err, context.defaultStatus ?? 500);
  const publicMessage =
    status >= 500
      ? context.defaultMessage
      : err instanceof Error
        ? err.message
        : context.defaultMessage;
  const logger = createLogger(context.module);

  logger.error('API request failed', {
    route: context.route,
    action: req.query.action,
    method: req.method,
    status,
    error: err,
    ...(context.metadata || {}),
  });

  return sendApiError(res, err, publicMessage);
}
