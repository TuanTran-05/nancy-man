import { describe, expect, test } from 'vitest';

import {
  parseSystemdEnvironmentFile,
  systemdEnvironmentFileAdapter
} from './systemdEnvironmentFile.js';

describe('systemd EnvironmentFile adapter', () => {
  test('parses comments, quoting, escapes, multiline values, duplicates and round-trips', () => {
    const fixture = Buffer.from(
      '# comment\r\nEMPTY=\r\nQUOTED="hello world"\nESCAPED=hello\\ world\nMULTI="first\nsecond ß"\nDUP=one\nDUP=two\n'
    );
    const parsed = systemdEnvironmentFileAdapter.parse(fixture);

    expect(
      parsed.definitions.map(({ name, value, duplicateOrdinal }) => ({
        name,
        value,
        duplicateOrdinal
      }))
    ).toEqual([
      { name: 'EMPTY', value: '', duplicateOrdinal: 0 },
      { name: 'QUOTED', value: 'hello world', duplicateOrdinal: 0 },
      { name: 'ESCAPED', value: 'hello world', duplicateOrdinal: 0 },
      { name: 'MULTI', value: 'first\nsecond ß', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'one', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'two', duplicateOrdinal: 1 }
    ]);
    expect(systemdEnvironmentFileAdapter.serialize(parsed)).toEqual(fixture);
    expect(parseSystemdEnvironmentFile(fixture).definitions).toHaveLength(6);
  });

  test('rejects malformed, oversized, nul, and invalid UTF-8 input', () => {
    expect(() => parseSystemdEnvironmentFile(Buffer.from('BROKEN\n'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_MALFORMED' })
    );
    expect(() =>
      parseSystemdEnvironmentFile(Buffer.from('A=123'), { maximumBytes: 3 })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LARGE' }));
    expect(() => parseSystemdEnvironmentFile(Buffer.from('A=\u0000'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_NUL_BYTE' })
    );
    expect(() => parseSystemdEnvironmentFile(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_UNSUPPORTED_ENCODING' })
    );
  });
});
