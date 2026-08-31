import {
  parseTextAssignments,
  serializeUnchanged,
  type ParseOptions,
  type ParsedSource,
  type SourceAdapter
} from './types.js';

export const nodeEnvFileAdapter: SourceAdapter = {
  id: 'node_env_file',
  parse: (bytes, options) => parseNodeEnvFile(bytes, options),
  serialize: serializeUnchanged
};

export function parseNodeEnvFile(bytes: Uint8Array, options: ParseOptions = {}): ParsedSource {
  return parseTextAssignments(bytes, 'node_env_file', options);
}

export function serializeNodeEnvFile(parsed: ParsedSource): Buffer {
  return serializeUnchanged(parsed);
}
