import { describe, expect, it } from 'vitest';
import { parseOpsE2eBaseUrl } from './baseUrl.js';

describe('Ops E2E base URL isolation', () => {
  it('requires an explicit verified-unused high loopback port', () => {
    expect(() => parseOpsE2eBaseUrl(undefined)).toThrow('OPS_E2E_BASE_URL is required');
    expect(() => parseOpsE2eBaseUrl('http://127.0.0.1:3101')).toThrow('high loopback port');
    expect(() => parseOpsE2eBaseUrl('http://localhost:49152')).toThrow('high loopback port');
    expect(() => parseOpsE2eBaseUrl('http://127.0.0.1:49152/not-root')).toThrow(
      'high loopback port'
    );
  });

  it('returns the exact allowed origin for request accounting', () => {
    expect(parseOpsE2eBaseUrl('http://127.0.0.1:49152')).toEqual({
      baseURL: 'http://127.0.0.1:49152',
      origin: 'http://127.0.0.1:49152',
      port: 49152
    });
  });
});
