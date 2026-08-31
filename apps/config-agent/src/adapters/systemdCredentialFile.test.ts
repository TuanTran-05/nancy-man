import { describe, expect, test } from 'vitest';

import {
  parseSystemdCredentialFile,
  systemdCredentialFileAdapter
} from './systemdCredentialFile.js';

describe('systemd credential adapter', () => {
  test('returns explicit base64 display data for opaque bytes and round-trips', () => {
    const fixture = Buffer.from([0x00, 0x01, 0xff, 0x7f]);
    const parsed = systemdCredentialFileAdapter.parse(fixture, {
      name: 'OPS_BINARY_CREDENTIAL',
      displayEncoding: 'base64'
    });

    expect(parsed.encoding).toBe('base64');
    expect(parsed.definitions).toHaveLength(1);
    expect(parsed.definitions[0]).toMatchObject({
      name: 'OPS_BINARY_CREDENTIAL',
      value: fixture.toString('base64'),
      valueBytes: fixture
    });
    expect(systemdCredentialFileAdapter.serialize(parsed)).toEqual(fixture);
  });

  test('only decodes UTF-8 when explicitly requested', () => {
    const fixture = Buffer.from('héllo', 'utf8');
    const parsed = parseSystemdCredentialFile(fixture, {
      name: 'OPS_TEXT_CREDENTIAL',
      displayEncoding: 'text'
    });
    expect(parsed.encoding).toBe('utf8');
    expect(parsed.definitions[0].value).toBe('héllo');
    expect(() =>
      parseSystemdCredentialFile(Buffer.from([0xc3, 0x28]), {
        name: 'OPS_TEXT_CREDENTIAL',
        displayEncoding: 'text'
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_UNSUPPORTED_ENCODING' }));
    expect(() =>
      parseSystemdCredentialFile(fixture, { name: 'OPS_TEXT_CREDENTIAL' } as never)
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_ENCODING_REQUIRED' }));
  });

  test('enforces the declared byte limit without inspecting opaque content', () => {
    expect(() =>
      parseSystemdCredentialFile(Buffer.from([0x00, 0x01]), {
        name: 'OPS_BINARY_CREDENTIAL',
        displayEncoding: 'base64',
        maximumBytes: 1
      })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LARGE' }));
  });
});
