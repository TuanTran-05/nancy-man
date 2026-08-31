import { describe, expect, it } from 'vitest';

import { serializeBuildEnvironment } from './runtimeHandlers.js';

describe('build environment serialization', () => {
  it('serializes a deterministic, line-oriented environment', () => {
    expect(
      serializeBuildEnvironment({ Z_LAST: 'last', A_FIRST: 'first', NODE_ENV: 'production' })
    ).toBe('A_FIRST=first\nNODE_ENV=production\nZ_LAST=last\n');
  });

  it.each([
    ['a lower-case name', { invalid_name: 'value' }],
    ['a newline in a value', { SAFE_NAME: 'before\nafter' }],
    ['a NUL in a value', { SAFE_NAME: 'before\u0000after' }]
  ])('rejects %s', (_label, environment) => {
    expect(() => serializeBuildEnvironment(environment)).toThrow('BUILD_ENVIRONMENT_INVALID');
  });
});
