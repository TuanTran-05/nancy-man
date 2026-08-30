import { createHash } from 'node:crypto';

export interface RedactedLogLine {
  safeText: string;
  fingerprint: string;
  isFatal: boolean;
}

const PAYLOAD_REDACTION = '[payload redacted]';

const redactStructuredPayloads = (line: string): string => {
  let safe = '';
  let cursor = 0;

  while (cursor < line.length) {
    let start = cursor;
    while (start < line.length && line[start] !== '{' && line[start] !== '[') start += 1;
    safe += line.slice(cursor, start);
    if (start === line.length) break;

    const delimiters: string[] = [];
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < line.length; index += 1) {
      const character = line[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === '{' || character === '[') {
        delimiters.push(character);
        continue;
      }
      if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (delimiters.at(-1) !== expected) break;
        delimiters.pop();
        if (delimiters.length === 0) {
          end = index + 1;
          break;
        }
      }
    }

    safe += PAYLOAD_REDACTION;
    if (end < 0) return safe;
    cursor = end;
  }

  return safe;
};

const redact = (line: string): string => {
  let value = redactStructuredPayloads(line);
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]');
  value = value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/giu, '$1[redacted]@');
  value = value.replace(
    /\b(authorization|token|secret|password|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu,
    '$1=[redacted]'
  );
  value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email redacted]');
  value = value.replace(/\b(?:\+84|0084|0)(?:3|5|7|8|9)\d{8,9}\b/gu, '[phone redacted]');
  value = value.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
    '[id redacted]'
  );
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
};

export function redactLogLine(line: string): RedactedLogLine {
  const safeText = redact(line);
  const fingerprint = createHash('sha256').update(safeText, 'utf8').digest('hex');
  return { safeText, fingerprint, isFatal: /\bFATAL\b/iu.test(line) };
}
