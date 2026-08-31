import {
  parseTextAssignments,
  serializeUnchanged,
  type ParseOptions,
  type ParsedSource,
  type SourceAdapter
} from './types.js';

export const dotenvFileAdapter: SourceAdapter = {
  id: 'dotenv',
  parse: (bytes, options) => parseDotenvFile(bytes, options),
  serialize: serializeUnchanged
};

export function parseDotenvFile(bytes: Uint8Array, options: ParseOptions = {}): ParsedSource {
  return parseTextAssignments(bytes, 'dotenv', options);
}

export function serializeDotenvFile(parsed: ParsedSource): Buffer {
  return serializeUnchanged(parsed);
}
