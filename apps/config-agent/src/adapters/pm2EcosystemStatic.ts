import {
  assertTextBytes,
  decodeUtf8,
  serializeUnchanged,
  SourceAdapterError,
  type ParseOptions,
  type ParsedDefinition,
  type ParsedSource,
  type SourceAdapter,
  type SourceToken
} from './types.js';

type TokenKind = 'identifier' | 'string' | 'number' | 'punctuation' | 'ellipsis' | 'eof';
type Token = Readonly<{
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}>;

type StaticValue =
  | Readonly<{
      kind: 'string' | 'number' | 'boolean' | 'null';
      value: string;
      start: number;
      end: number;
    }>
  | Readonly<{ kind: 'object'; properties: readonly Property[]; start: number; end: number }>
  | Readonly<{ kind: 'array'; values: readonly StaticValue[]; start: number; end: number }>;
type Property = Readonly<{ key: string; keyToken: Token; value: StaticValue }>;

const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function fail(): never {
  throw new SourceAdapterError('PM2_STATIC_EXPRESSION_REJECTED');
}

function decodeString(raw: string): string {
  let value = '';
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '\\') {
      value += raw[index];
      continue;
    }
    if (index + 1 >= raw.length) fail();
    const escaped = raw[++index];
    value += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
  }
  return value;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) fail();
      index = end + 2;
      continue;
    }
    if (source.startsWith('...', index)) {
      tokens.push({ kind: 'ellipsis', value: '...', start: index, end: index + 3 });
      index += 3;
      continue;
    }
    if ('{}[]:,.=;'.includes(character)) {
      tokens.push({ kind: 'punctuation', value: character, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const start = index;
      index += 1;
      let raw = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '\n' || current === '\r') fail();
        if (current === '\\') {
          if (index + 1 >= source.length) fail();
          raw += current + source[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          closed = true;
          break;
        }
        raw += current;
        index += 1;
      }
      if (!closed) fail();
      tokens.push({ kind: 'string', value: decodeString(raw), start, end: index });
      continue;
    }
    if (/[0-9-]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.eE+-]/u.test(source[index] ?? '')) index += 1;
      const value = source.slice(start, index);
      if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(value)) fail();
      tokens.push({ kind: 'number', value, start, end: index });
      continue;
    }
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(source.slice(index));
    if (identifier) {
      const value = identifier[0];
      tokens.push({ kind: 'identifier', value, start: index, end: index + value.length });
      index += value.length;
      continue;
    }
    fail();
  }
  tokens.push({ kind: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

class StaticParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private current(): Token {
    return this.tokens[this.index] ?? fail();
  }

  private consume(value: string): Token {
    const token = this.current();
    if (token.value !== value) fail();
    this.index += 1;
    return token;
  }

  private maybe(value: string): Token | null {
    if (this.current().value !== value) return null;
    return this.consume(value);
  }

  private parseObject(): StaticValue {
    const open = this.consume('{');
    const properties: Property[] = [];
    while (this.current().value !== '}') {
      if (this.current().kind === 'ellipsis' || this.current().value === '[') fail();
      const keyToken = this.current();
      if (keyToken.kind !== 'identifier' && keyToken.kind !== 'string') fail();
      this.index += 1;
      this.consume(':');
      properties.push({ key: keyToken.value, keyToken, value: this.parseValue() });
      if (!this.maybe(',')) break;
      if (this.current().value === '}') break;
    }
    const close = this.consume('}');
    return { kind: 'object', properties, start: open.start, end: close.end };
  }

  private parseArray(): StaticValue {
    const open = this.consume('[');
    const values: StaticValue[] = [];
    while (this.current().value !== ']') {
      if (this.current().kind === 'ellipsis') fail();
      values.push(this.parseValue());
      if (!this.maybe(',')) break;
      if (this.current().value === ']') break;
    }
    const close = this.consume(']');
    return { kind: 'array', values, start: open.start, end: close.end };
  }

  private parseValue(): StaticValue {
    const token = this.current();
    if (token.value === '{') return this.parseObject();
    if (token.value === '[') return this.parseArray();
    if (token.kind === 'string' || token.kind === 'number') {
      this.index += 1;
      return { kind: token.kind, value: token.value, start: token.start, end: token.end };
    }
    if (token.kind === 'identifier' && (token.value === 'true' || token.value === 'false')) {
      this.index += 1;
      return { kind: 'boolean', value: token.value, start: token.start, end: token.end };
    }
    if (token.kind === 'identifier' && token.value === 'null') {
      this.index += 1;
      return { kind: 'null', value: '', start: token.start, end: token.end };
    }
    fail();
  }

  parseExport(): StaticValue {
    if (this.current().value === 'module') {
      this.consume('module');
      this.consume('.');
      this.consume('exports');
      this.consume('=');
    } else if (this.current().value === 'export') {
      this.consume('export');
      this.consume('default');
    } else {
      fail();
    }
    const value = this.parseValue();
    this.maybe(';');
    if (this.current().kind !== 'eof') fail();
    return value;
  }
}

function property(value: StaticValue, name: string): Property | undefined {
  if (value.kind !== 'object') return undefined;
  return value.properties.find((entry) => entry.key === name);
}

function byteOffset(source: string, characterOffset: number): number {
  return Buffer.byteLength(source.slice(0, characterOffset), 'utf8');
}

function sourceToken(kind: string, source: string, start: number, end: number): SourceToken {
  return {
    kind,
    text: source.slice(start, end),
    byteStart: byteOffset(source, start),
    byteEnd: byteOffset(source, end)
  };
}

function parsePm2(bytes: Uint8Array, options: ParseOptions = {}): ParsedSource {
  const sourceBytes = assertTextBytes(bytes, options.maximumBytes);
  const source = decodeUtf8(sourceBytes);
  const root = new StaticParser(tokenize(source)).parseExport();
  const apps = property(root, 'apps')?.value;
  if (!apps || apps.kind !== 'array') fail();

  const definitions: ParsedDefinition[] = [];
  const ordinals = new Map<string, number>();
  apps.values.forEach((app, appIndex) => {
    if (app.kind !== 'object') fail();
    const appNameValue = property(app, 'name')?.value;
    const appName = appNameValue?.kind === 'string' ? appNameValue.value : `app-${appIndex}`;
    const env = property(app, 'env')?.value;
    if (env === undefined) return;
    if (env.kind !== 'object') fail();
    env.properties.forEach(({ key, keyToken, value }) => {
      if (!variableNamePattern.test(key)) fail();
      if (value.kind === 'object' || value.kind === 'array') fail();
      const duplicateOrdinal = ordinals.get(key) ?? 0;
      ordinals.set(key, duplicateOrdinal + 1);
      const byteStart = byteOffset(source, keyToken.start);
      const byteEnd = byteOffset(source, value.end);
      definitions.push({
        name: key,
        value: value.value,
        valueBytes: Buffer.from(value.value, 'utf8'),
        duplicateOrdinal,
        byteStart,
        byteEnd,
        rawBytes: Buffer.from(sourceBytes.subarray(byteStart, byteEnd)),
        tokens: [
          sourceToken('name', source, keyToken.start, keyToken.end),
          sourceToken('literal', source, value.start, value.end)
        ],
        line: source.slice(0, keyToken.start).split(/\r\n|\r|\n/u).length,
        appName,
        literalType: value.kind
      });
    });
  });

  return {
    adapterId: 'pm2_ecosystem_static',
    bytes: Buffer.from(sourceBytes),
    definitions,
    records: definitions,
    diagnostics: [],
    encoding: 'utf8',
    unchanged: true
  };
}

export const pm2EcosystemStaticAdapter: SourceAdapter = {
  id: 'pm2_ecosystem_static',
  parse: (bytes, options) => parsePm2EcosystemStatic(bytes, options),
  serialize: serializeUnchanged
};

export function parsePm2EcosystemStatic(
  bytes: Uint8Array,
  options: ParseOptions = {}
): ParsedSource {
  return parsePm2(bytes, options);
}

export function serializePm2EcosystemStatic(parsed: ParsedSource): Buffer {
  return serializeUnchanged(parsed);
}
