import { sanitizeLogContext } from './logSanitizer.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function log(
  level: LogLevel,
  module: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...sanitizeLogContext(context),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      if (process.env.NODE_ENV !== 'production') console.log(line);
      break;
    default:
      console.log(line);
  }
}

export function createLogger(module: string) {
  return {
    info: (message: string, context?: Record<string, unknown>) =>
      log('info', module, message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
      log('warn', module, message, context),
    error: (message: string, context?: Record<string, unknown>) =>
      log('error', module, message, context),
    debug: (message: string, context?: Record<string, unknown>) =>
      log('debug', module, message, context),
  };
}
