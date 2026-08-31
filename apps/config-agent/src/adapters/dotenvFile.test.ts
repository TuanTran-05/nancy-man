import { describe, expect, test } from 'vitest';

import { dotenvFileAdapter, parseDotenvFile } from './dotenvFile.js';

describe('dotenv adapter', () => {
  test('parses dotenv syntax and round-trips unchanged bytes', () => {
    const fixture = Buffer.from(
      '  # comment\nexport EMPTY=\nNAME="quoted value"\nESCAPED=hello\\ world\nMULTI="first\nsecond ñ"\nDUP=one\nDUP=two\n'
    );
    const parsed = dotenvFileAdapter.parse(fixture);

    expect(
      parsed.definitions.map(({ name, value, duplicateOrdinal }) => ({
        name,
        value,
        duplicateOrdinal
      }))
    ).toEqual([
      { name: 'EMPTY', value: '', duplicateOrdinal: 0 },
      { name: 'NAME', value: 'quoted value', duplicateOrdinal: 0 },
      { name: 'ESCAPED', value: 'hello world', duplicateOrdinal: 0 },
      { name: 'MULTI', value: 'first\nsecond ñ', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'one', duplicateOrdinal: 0 },
      { name: 'DUP', value: 'two', duplicateOrdinal: 1 }
    ]);
    expect(dotenvFileAdapter.serialize(parsed)).toEqual(fixture);
    expect(parseDotenvFile(fixture).definitions).toHaveLength(6);
  });

  test('rejects malformed, oversized, nul, and invalid UTF-8 input', () => {
    expect(() => parseDotenvFile(Buffer.from('BROKEN\n'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_MALFORMED' })
    );
    expect(() => parseDotenvFile(Buffer.from('A=123'), { maximumBytes: 3 })).toThrowError(
      expect.objectContaining({ code: 'SOURCE_TOO_LARGE' })
    );
    expect(() => parseDotenvFile(Buffer.from('A=\u0000'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_NUL_BYTE' })
    );
    expect(() => parseDotenvFile(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_UNSUPPORTED_ENCODING' })
    );
  });
});
