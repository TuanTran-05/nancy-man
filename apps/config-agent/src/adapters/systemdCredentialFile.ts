import { TextDecoder } from 'node:util';

import {
  asBuffer,
  SourceAdapterError,
  type ParseOptions,
  type ParsedDefinition,
  type ParsedSource,
  type SourceAdapter
} from './types.js';

export type CredentialDisplayEncoding = 'text' | 'base64';

export type CredentialParseOptions = ParseOptions &
  Readonly<{
    name: string;
    displayEncoding: CredentialDisplayEncoding;
  }>;

function parseCredential(bytes: Uint8Array, options: CredentialParseOptions): ParsedSource {
  if (options.displayEncoding !== 'text' && options.displayEncoding !== 'base64') {
    throw new SourceAdapterError('CREDENTIAL_ENCODING_REQUIRED');
  }
  const sourceBytes = asBuffer(bytes);
  const maximumBytes = options.maximumBytes ?? 1_048_576;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    sourceBytes.byteLength > maximumBytes
  ) {
    throw new SourceAdapterError('SOURCE_TOO_LARGE');
  }
  let value: string;
  if (options.displayEncoding === 'base64') {
    value = sourceBytes.toString('base64');
  } else {
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
    } catch {
      throw new SourceAdapterError('SOURCE_UNSUPPORTED_ENCODING');
    }
  }
  const definition: ParsedDefinition = {
    name: options.name,
    value,
    valueBytes: Buffer.from(sourceBytes),
    duplicateOrdinal: 0,
    byteStart: 0,
    byteEnd: sourceBytes.byteLength,
    rawBytes: Buffer.from(sourceBytes),
    tokens: [],
    line: 1
  };
  return {
    adapterId: 'systemd_credential_file',
    bytes: Buffer.from(sourceBytes),
    definitions: [definition],
    records: [definition],
    diagnostics: [],
    encoding: options.displayEncoding === 'text' ? 'utf8' : 'base64',
    unchanged: true
  };
}

export const systemdCredentialFileAdapter = {
  id: 'systemd_credential_file' as const,
  parse: (bytes: Uint8Array, options?: CredentialParseOptions) => {
    if (!options) throw new SourceAdapterError('CREDENTIAL_ENCODING_REQUIRED');
    return parseCredential(bytes, options);
  },
  serialize: (parsed: ParsedSource): Buffer => Buffer.from(parsed.bytes)
} satisfies Omit<SourceAdapter, 'parse'> & {
  id: 'systemd_credential_file';
  parse: (bytes: Uint8Array, options?: CredentialParseOptions) => ParsedSource;
  serialize: (parsed: ParsedSource) => Buffer;
};

export function parseSystemdCredentialFile(
  bytes: Uint8Array,
  options?: CredentialParseOptions
): ParsedSource {
  if (!options) throw new SourceAdapterError('CREDENTIAL_ENCODING_REQUIRED');
  return parseCredential(bytes, options);
}

export function serializeSystemdCredentialFile(parsed: ParsedSource): Buffer {
  return Buffer.from(parsed.bytes);
}
