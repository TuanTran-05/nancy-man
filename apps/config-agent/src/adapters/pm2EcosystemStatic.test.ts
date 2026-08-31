import { describe, expect, test } from 'vitest';

import { parsePm2EcosystemStatic, pm2EcosystemStaticAdapter } from './pm2EcosystemStatic.js';

describe('pm2_ecosystem_static adapter', () => {
  test('reads only literal apps.env fields and round-trips source bytes', () => {
    const fixture = Buffer.from(`// static PM2 config
module.exports = {
  apps: [
    { name: 'api', env: { NODE_ENV: 'production', PORT: 3100, EMPTY: '' } },
    { name: 'worker', env: { DUP: 'one', DUP: 'two', UNICODE: 'Hà Nội' } }
  ]
};
`);
    const parsed = pm2EcosystemStaticAdapter.parse(fixture);

    expect(
      parsed.definitions.map(({ name, value, duplicateOrdinal, appName }) => ({
        name,
        value,
        duplicateOrdinal,
        appName
      }))
    ).toEqual([
      { name: 'NODE_ENV', value: 'production', duplicateOrdinal: 0, appName: 'api' },
      { name: 'PORT', value: '3100', duplicateOrdinal: 0, appName: 'api' },
      { name: 'EMPTY', value: '', duplicateOrdinal: 0, appName: 'api' },
      { name: 'DUP', value: 'one', duplicateOrdinal: 0, appName: 'worker' },
      { name: 'DUP', value: 'two', duplicateOrdinal: 1, appName: 'worker' },
      { name: 'UNICODE', value: 'Hà Nội', duplicateOrdinal: 0, appName: 'worker' }
    ]);
    expect(pm2EcosystemStaticAdapter.serialize(parsed)).toEqual(fixture);
    expect(parsePm2EcosystemStatic(fixture).definitions).toHaveLength(6);
  });

  test.each([
    ['function calls', 'module.exports = { apps: [{ env: { PORT: getPort() } }] };'],
    ['getters', "module.exports = { apps: [{ env: { get PORT() { return '3100'; } } }] };"],
    ['spreads', "module.exports = { apps: [{ env: { ...process.env, PORT: '3100' } }] };"],
    ['computed keys', "module.exports = { apps: [{ env: { [process.env.NAME]: 'x' } }] };"],
    [
      'dynamic export execution',
      "module.exports = (() => { throw new Error('must not execute'); })();"
    ]
  ])('rejects %s without executing source', (_label, source) => {
    expect(() => parsePm2EcosystemStatic(Buffer.from(source))).toThrowError(
      expect.objectContaining({ code: 'PM2_STATIC_EXPRESSION_REJECTED' })
    );
  });

  test('rejects oversized, nul, and invalid UTF-8 source', () => {
    expect(() =>
      parsePm2EcosystemStatic(Buffer.from('module.exports = {};'), { maximumBytes: 3 })
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LARGE' }));
    expect(() => parsePm2EcosystemStatic(Buffer.from('module.exports = {\u0000};'))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_NUL_BYTE' })
    );
    expect(() => parsePm2EcosystemStatic(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'SOURCE_UNSUPPORTED_ENCODING' })
    );
  });
});
