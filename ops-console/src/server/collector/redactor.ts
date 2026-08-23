import { createHash } from 'node:crypto';

export interface RedactedLogLine {
  safeText: string;
  fingerprint: string;
  isFatal: boolean;
}

const redact = (line: string): string => {
  let value = line.replace(/\{[^{}]*\}|\[[^\[\]]*\]/gu, '[payload redacted]');
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]');
  value = value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/giu, '$1[redacted]@');
  value = value.replace(/\b(authorization|token|secret|password|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]');
  value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email redacted]');
  value = value.replace(/\b(?:\+84|0084|0)(?:3|5|7|8|9)\d{8,9}\b/gu, '[phone redacted]');
  value = value.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[id redacted]');
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
};

export function redactLogLine(line: string): RedactedLogLine {
  const safeText = redact(line);
  const fingerprint = createHash('sha256').update(safeText, 'utf8').digest('hex');
  return { safeText, fingerprint, isFatal: /\bFATAL\b/iu.test(line) };
}
