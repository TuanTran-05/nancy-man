import { describe, expect, it } from 'vitest';
import {
  SCALABILITY_TARGETS,
  buildScalabilityOptions,
} from '../../../../loadtests/lib/scalabilityThresholds.ts';

describe('scalability load test thresholds', () => {
  it('defines explicit 1k, 5k, and 10k production-readiness targets', () => {
    expect(Object.keys(SCALABILITY_TARGETS)).toEqual(['1k', '5k', '10k']);
    expect(SCALABILITY_TARGETS['1k'].thresholds.http_req_duration).toContain('p(95)<1500');
    expect(SCALABILITY_TARGETS['5k'].thresholds.http_req_duration).toContain('p(95)<2500');
    expect(SCALABILITY_TARGETS['10k'].thresholds.http_req_duration).toContain('p(95)<4000');
    expect(SCALABILITY_TARGETS['10k'].thresholds.http_req_failed).toContain('rate<0.05');
  });

  it('builds k6 options for the selected target without changing endpoint code', () => {
    const options = buildScalabilityOptions('5k');

    expect(options.scenarios.steady_read_write_mix.vus).toBe(150);
    expect(options.scenarios.steady_read_write_mix.duration).toBe('10m');
    expect(options.thresholds.http_req_duration).toEqual(['p(95)<2500', 'p(99)<5000']);
  });
});
