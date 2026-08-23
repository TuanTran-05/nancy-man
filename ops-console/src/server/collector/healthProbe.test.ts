import { describe, expect, it } from 'vitest';
import { probeApp } from './healthProbe.js';

describe('loopback application probes', () => {
  it('uses only the fixed loopback liveness route and a bounded request', async () => {
    let requested = '';
    const sample = await probeApp({ appUrl: 'http://127.0.0.1:3000', fetchImpl: async (input) => { requested = String(input); return new Response(JSON.stringify({ status: 'ok', release: 'abc-1' }), { status: 200 }); } }, 'liveness', new Date('2026-08-23T00:00:00Z'));
    expect(requested).toBe('http://127.0.0.1:3000/api/v1/liveness');
    expect(sample).toMatchObject({ monitor: 'app_liveness', level: 'healthy', details: { probeOk: true, release: 'abc-1' } });
  });

  it('never probes a public URL and sanitizes failures', async () => {
    let called = false;
    const sample = await probeApp({ appUrl: 'http://example.com', fetchImpl: async () => { called = true; return new Response(); } }, 'health');
    expect(called).toBe(false);
    expect(sample).toMatchObject({ level: 'critical', errorCode: 'app_non_loopback_url', details: {} });
  });
});
