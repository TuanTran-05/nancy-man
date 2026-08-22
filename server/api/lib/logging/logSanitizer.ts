const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const TOKEN_KEY_PATTERN =
  /^(authorization|access[_-]?token|refresh[_-]?token|reset[_-]?token|custom[_-]?token|id[_-]?token|storageDownloadToken|token)$/i;

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /([?&](?:access_token|refresh_token|resetToken|customToken|idToken|token)=)[^&#\s"'<>]+/gi,
      `$1${REDACTED}`
    )
    .replace(/((?:https?:\/\/|www\.)[^\s"'<>#]+)#[^\s"'<>]*/gi, `$1#${REDACTED}`)
    .replace(
      /(["']?(?:access_token|refresh_token|accessToken|refreshToken|resetToken|customToken|idToken|token)["']?\s*[:=]\s*["'])[^"']+(["'])/gi,
      `$1${REDACTED}$2`
    )
    .replace(
      /\b(access_token|refresh_token|accessToken|refreshToken|resetToken|customToken|idToken|token)=([^\s"'&]+)/gi,
      `$1=${REDACTED}`
    );
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = TOKEN_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(nestedValue, depth + 1, seen);
  }
  return sanitized;
}

export function sanitizeLogValue<T = unknown>(value: T): T {
  return sanitizeValue(value, 0, new WeakSet<object>()) as T;
}

export function sanitizeLogContext(
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return sanitizeLogValue(context);
}

export function sanitizeError(error: unknown): unknown {
  if (error instanceof Error) {
    const sanitized = new Error(redactString(error.message));
    sanitized.name = error.name;
    if (error.stack) sanitized.stack = redactString(error.stack);
    return sanitized;
  }
  return sanitizeLogValue(error);
}
