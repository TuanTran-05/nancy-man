import { TextDecoder } from 'node:util';

export type SourceAdapterId =
  | 'node_env_file'
  | 'systemd_environment_file'
  | 'systemd_credential_file'
  | 'dotenv'
  | 'pm2_ecosystem_static';

export type SourceAdapterErrorCode =
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_NUL_BYTE'
  | 'SOURCE_UNSUPPORTED_ENCODING'
  | 'SOURCE_MALFORMED'
  | 'CREDENTIAL_ENCODING_REQUIRED'
  | 'PM2_STATIC_EXPRESSION_REJECTED';

export class SourceAdapterError extends Error {
  readonly code: SourceAdapterErrorCode;
  readonly line: number | null;

  constructor(code: SourceAdapterErrorCode, line: number | null = null) {
    super(code);
    this.name = 'SourceAdapterError';
    this.code = code;
    this.line = line;
  }
}

export type SourceToken = Readonly<{
  kind: string;
  byteStart: number;
  byteEnd: number;
  text: string;
}>;

export type ParsedDefinition = Readonly<{
  name: string;
  value: string;
  valueBytes: Buffer;
  duplicateOrdinal: number;
  byteStart: number;
  byteEnd: number;
  rawBytes: Buffer;
  tokens: readonly SourceToken[];
  line: number;
  appName?: string;
  literalType?: 'string' | 'number' | 'boolean' | 'null';
}>;

export type ParsedSource = Readonly<{
  adapterId: SourceAdapterId;
  bytes: Buffer;
  definitions: readonly ParsedDefinition[];
  /** Alias useful to callers that call source definitions records. */
  records: readonly ParsedDefinition[];
  diagnostics: readonly never[];
  encoding: 'utf8' | 'base64';
  unchanged: true;
}>;

export type ParseOptions = Readonly<{
  maximumBytes?: number;
}>;

export type SourceAdapter = Readonly<{
  readonly id: SourceAdapterId;
  parse(bytes: Uint8Array, options?: ParseOptions): ParsedSource;
  serialize(parsed: ParsedSource): Buffer;
}>;

export type SourceWriteOperation = Readonly<{
  name: string;
  duplicateOrdinal: number;
  operation: 'set' | 'delete';
  requirement: 'required' | 'optional';
  value?: string;
  valueEncoding?: 'text' | 'base64';
}>;

export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes);
}

export function assertTextBytes(bytes: Uint8Array, maximumBytes = 1_048_576): Buffer {
  const buffer = asBuffer(bytes);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new SourceAdapterError('SOURCE_TOO_LARGE');
  }
  if (buffer.byteLength > maximumBytes) throw new SourceAdapterError('SOURCE_TOO_LARGE');
  if (buffer.includes(0)) throw new SourceAdapterError('SOURCE_NUL_BYTE');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new SourceAdapterError('SOURCE_UNSUPPORTED_ENCODING');
  }
  return buffer;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SourceAdapterError('SOURCE_UNSUPPORTED_ENCODING');
  }
}

function byteOffset(text: string, characterOffset: number): number {
  return Buffer.byteLength(text.slice(0, characterOffset), 'utf8');
}

function token(
  kind: string,
  text: string,
  source: string,
  start: number,
  end: number
): SourceToken {
  return { kind, text, byteStart: byteOffset(source, start), byteEnd: byteOffset(source, end) };
}

function decodeEscapes(value: string, quote: 'single' | 'double' | null): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\' || index + 1 >= value.length) {
      result += character;
      continue;
    }
    const escaped = value[++index];
    if (quote === 'double') {
      result += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
    } else {
      result += escaped;
    }
  }
  return result;
}

function statementEnd(text: string, start: number): { end: number; next: number } {
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === (quote === 'single' ? "'" : '"')) quote = null;
      continue;
    }
    if (character === "'") {
      quote = 'single';
      continue;
    }
    if (character === '"') {
      quote = 'double';
      continue;
    }
    if (character === '#') {
      while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index += 1;
      if (index >= text.length) return { end: text.length, next: text.length };
      return {
        end: index,
        next: text[index] === '\r' && text[index + 1] === '\n' ? index + 2 : index + 1
      };
    }
    if (character === '\n') return { end: index, next: index + 1 };
    if (character === '\r')
      return { end: index, next: text[index + 1] === '\n' ? index + 2 : index + 1 };
  }
  if (quote) throw new SourceAdapterError('SOURCE_MALFORMED');
  return { end: text.length, next: text.length };
}

function skipWhitespace(text: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/u.test(text[index] ?? '')) index += 1;
  return index;
}

function parseValue(
  text: string,
  start: number,
  end: number,
  line: number
): { value: string; valueStart: number; valueEnd: number; quote: 'single' | 'double' | null } {
  const valueStart = skipWhitespace(text, start, end);
  if (valueStart >= end || text[valueStart] === '#') {
    return { value: '', valueStart, valueEnd: valueStart, quote: null };
  }

  const opener = text[valueStart];
  if (opener === "'" || opener === '"') {
    const quote: 'single' | 'double' = opener === "'" ? 'single' : 'double';
    const contentStart = valueStart + 1;
    let escaped = false;
    for (let index = contentStart; index < end; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === opener) {
        const afterQuote = skipWhitespace(text, index + 1, end);
        if (afterQuote < end && text[afterQuote] !== '#') {
          throw new SourceAdapterError('SOURCE_MALFORMED', line);
        }
        return {
          value: decodeEscapes(text.slice(contentStart, index), quote),
          valueStart,
          valueEnd: afterQuote,
          quote
        };
      }
    }
    throw new SourceAdapterError('SOURCE_MALFORMED', line);
  }

  let value = '';
  let escaped = false;
  let valueEnd = valueStart;
  for (let index = valueStart; index < end; index += 1) {
    const character = text[index];
    if (escaped) {
      value += character;
      escaped = false;
      valueEnd = index + 1;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      value += character;
      valueEnd = index + 1;
      continue;
    }
    if (character === '#' && (index === valueStart || /\s/u.test(text[index - 1] ?? ''))) break;
    value += character;
    valueEnd = index + 1;
  }
  if (escaped) throw new SourceAdapterError('SOURCE_MALFORMED', line);
  return {
    value: decodeEscapes(value, null).trimEnd(),
    valueStart,
    valueEnd,
    quote: null
  };
}

export function parseTextAssignments(
  bytes: Uint8Array,
  adapterId: Exclude<SourceAdapterId, 'systemd_credential_file' | 'pm2_ecosystem_static'>,
  options: ParseOptions = {}
): ParsedSource {
  const sourceBytes = assertTextBytes(bytes, options.maximumBytes);
  const text = decodeUtf8(sourceBytes);
  const definitions: ParsedDefinition[] = [];
  const ordinals = new Map<string, number>();
  let start = 0;
  let line = 1;
  while (start < text.length) {
    const { end, next } = statementEnd(text, start);
    let cursor = skipWhitespace(text, start, end);
    if (cursor < end && text[cursor] !== '#') {
      if (text.startsWith('export', cursor) && /\s/u.test(text[cursor + 6] ?? '')) {
        cursor = skipWhitespace(text, cursor + 6, end);
      }
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(text.slice(cursor, end));
      if (!nameMatch) throw new SourceAdapterError('SOURCE_MALFORMED', line);
      const name = nameMatch[0];
      const nameStart = cursor;
      cursor += name.length;
      cursor = skipWhitespace(text, cursor, end);
      if (text[cursor] !== '=') throw new SourceAdapterError('SOURCE_MALFORMED', line);
      const parsedValue = parseValue(text, cursor + 1, end, line);
      const duplicateOrdinal = ordinals.get(name) ?? 0;
      ordinals.set(name, duplicateOrdinal + 1);
      const byteStart = byteOffset(text, start);
      const byteEnd = byteOffset(text, next);
      definitions.push({
        name,
        value: parsedValue.value,
        valueBytes: Buffer.from(parsedValue.value, 'utf8'),
        duplicateOrdinal,
        byteStart,
        byteEnd,
        rawBytes: Buffer.from(sourceBytes.subarray(byteStart, byteEnd)),
        tokens: [
          token('name', name, text, nameStart, nameStart + name.length),
          token('assignment', '=', text, cursor, cursor + 1),
          token(
            'value',
            text.slice(parsedValue.valueStart, parsedValue.valueEnd),
            text,
            parsedValue.valueStart,
            parsedValue.valueEnd
          )
        ],
        line
      });
    }
    start = next;
    line += [...text.slice(end, next)].filter((character) => character === '\n').length;
  }
  return {
    adapterId,
    bytes: Buffer.from(sourceBytes),
    definitions,
    records: definitions,
    diagnostics: [],
    encoding: 'utf8',
    unchanged: true
  };
}

export function serializeUnchanged(parsed: ParsedSource): Buffer {
  if (!parsed.unchanged) throw new SourceAdapterError('SOURCE_MALFORMED');
  return Buffer.from(parsed.bytes);
}

function encodedValue(definition: ParsedDefinition, value: string): Buffer {
  const valueToken = definition.tokens.find(
    (candidate) => candidate.kind === 'value' || candidate.kind === 'literal'
  );
  const original = valueToken?.text ?? '';
  const quote = original.startsWith("'") ? "'" : original.startsWith('"') ? '"' : null;
  if (quote) {
    const escaped = value
      .replaceAll('\\', '\\\\')
      .replaceAll(quote, `\\${quote}`);
    return Buffer.from(`${quote}${escaped}${quote}`, 'utf8');
  }
  if (value.length === 0) return Buffer.alloc(0);
  if (/^[^\s#\\'"=]+$/u.test(value)) return Buffer.from(value, 'utf8');
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return Buffer.from(`"${escaped}"`, 'utf8');
}

export function serializeUpdatedSource(
  parsed: ParsedSource,
  operations: readonly SourceWriteOperation[]
): Buffer {
  if (!parsed.unchanged) throw new SourceAdapterError('SOURCE_MALFORMED');
  if (parsed.adapterId === 'pm2_ecosystem_static') {
    throw new SourceAdapterError('PM2_STATIC_EXPRESSION_REJECTED');
  }
  if (parsed.adapterId === 'systemd_credential_file') {
    if (operations.length !== 1 || operations[0]?.duplicateOrdinal !== 0) {
      throw new SourceAdapterError('SOURCE_MALFORMED');
    }
    const operation = operations[0];
    if (operation?.operation === 'delete') {
      if (operation.requirement !== 'optional') throw new SourceAdapterError('SOURCE_MALFORMED');
      return Buffer.alloc(0);
    }
    if (operation?.value === undefined) throw new SourceAdapterError('SOURCE_MALFORMED');
    if (operation.valueEncoding === 'base64') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(operation.value)) {
        throw new SourceAdapterError('SOURCE_MALFORMED');
      }
      const decoded = Buffer.from(operation.value, 'base64');
      if (decoded.toString('base64') !== operation.value) {
        throw new SourceAdapterError('SOURCE_MALFORMED');
      }
      return decoded;
    }
    return Buffer.from(operation.value, 'utf8');
  }

  const definitions = new Map(
    parsed.definitions.map((definition) => [
      `${definition.name}\u0000${definition.duplicateOrdinal}`,
      definition
    ])
  );
  const replacements: Array<{ start: number; end: number; bytes: Buffer }> = [];
  for (const operation of operations) {
    if (operation.operation === 'delete' && operation.requirement !== 'optional') {
      throw new SourceAdapterError('SOURCE_MALFORMED');
    }
    if (operation.operation === 'set' && operation.value === undefined) {
      throw new SourceAdapterError('SOURCE_MALFORMED');
    }
    const definition = definitions.get(`${operation.name}\u0000${operation.duplicateOrdinal}`);
    if (!definition) throw new SourceAdapterError('SOURCE_MALFORMED');
    if (operation.operation === 'delete') {
      replacements.push({ start: definition.byteStart, end: definition.byteEnd, bytes: Buffer.alloc(0) });
      continue;
    }
    const token = definition.tokens.find(
      (candidate) => candidate.kind === 'value' || candidate.kind === 'literal'
    );
    if (!token) throw new SourceAdapterError('SOURCE_MALFORMED');
    replacements.push({
      start: token.byteStart,
      end: token.byteEnd,
      bytes: encodedValue(definition, operation.value ?? '')
    });
  }
  replacements.sort((left, right) => right.start - left.start);
  let result = Buffer.from(parsed.bytes);
  for (const replacement of replacements) {
    result = Buffer.concat([
      result.subarray(0, replacement.start),
      replacement.bytes,
      result.subarray(replacement.end)
    ]);
  }
  return result;
}
