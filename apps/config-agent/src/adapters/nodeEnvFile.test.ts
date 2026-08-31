import { describe, expect, test } from 'vitest';

import { nodeEnvFileAdapter, parseNodeEnvFile } from './nodeEnvFile.js';

describe('node_env_file adapter', () => {
  test('parses supported syntax and round-trips unchanged bytes', () => {
    const fixture = Buffer.from(
      "# comment\r\nEMPTY=\r\nexport SINGLE='hello\\' world'\nDOUBLE=\"line one\nline two ß\"\nDUP=one\nDUP=two\n"
    );

    const parsed = nodeEnvFileAdapter.parse(fixture);

    expect(
      parsed.definitions.map(({ name, value, duplicateOrdinal }) => ({
        name,
        value,
        duplicateOrdinal
      }))
    ).toEqual([
      { name: 'EMPTY', value: '', duplicateOrdinal: 0 },
      { name: 'SINGLE', value: "hello' world", duplicateOrdinal: 0 },
      { name: 'DOUBLE', value: 'line one\nline two ß', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'one', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'two', duplicateOrdinal: 1 }
    ]);
    expect(nodeEnvFileAdapter.serialize(parsed)).toEqual(fixture);
    expect(parseNodeEnvFile(fixture).definitions).toHaveLength(5);
  });

  test('rejects malformed, oversized, nul, and invalid UTF-8 input', () => {
    expect(() => parseNodeEnvFile(Buffer.from('BROKEN\n'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_MALFORMED' })
    );
    expect(() => parseNodeEnvFile(Buffer.from('A=123'), { maximumBytes: 3 })).toThrowError(
      expect.objectContaining({ code: 'SOURCE_TOO_LARGE' })
    );
    expect(() => parseNodeEnvFile(Buffer.from('A=\u0000'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_NUL_BYTE' })
    );
    expect(() => parseNodeEnvFile(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_UNSUPPORTED_ENCODING' })
    );
  });
});
