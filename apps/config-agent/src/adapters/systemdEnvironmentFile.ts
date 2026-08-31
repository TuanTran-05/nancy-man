import {
  parseTextAssignments,
  serializeUnchanged,
  type ParseOptions,
  type ParsedSource,
  type SourceAdapter
} from './types.js';

export const systemdEnvironmentFileAdapter: SourceAdapter = {
  id: 'systemd_environment_file',
  parse: (bytes, options) => parseSystemdEnvironmentFile(bytes, options),
  serialize: serializeUnchanged
};

export function parseSystemdEnvironmentFile(
  bytes: Uint8Array,
  options: ParseOptions = {}
): ParsedSource {
  return parseTextAssignments(bytes, 'systemd_environment_file', options);
}

export function serializeSystemdEnvironmentFile(parsed: ParsedSource): Buffer {
  return serializeUnchanged(parsed);
}
