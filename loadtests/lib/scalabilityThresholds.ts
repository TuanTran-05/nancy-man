export type ScalabilityTarget = '1k' | '5k' | '10k';

export type ScalabilityProfile = {
  label: string;
  expectedUsers: number;
  vus: number;
  duration: string;
  thresholds: Record<string, string[]>;
};

export const SCALABILITY_TARGETS: Record<ScalabilityTarget, ScalabilityProfile> = {
  '1k': {
    label: 'Internal production target: 1,000 users',
    expectedUsers: 1000,
    vus: 50,
    duration: '8m',
    thresholds: {
      http_req_duration: ['p(95)<1500', 'p(99)<3000'],
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
    },
  },
  '5k': {
    label: 'Growth target: 5,000 users',
    expectedUsers: 5000,
    vus: 150,
    duration: '10m',
    thresholds: {
      http_req_duration: ['p(95)<2500', 'p(99)<5000'],
      http_req_failed: ['rate<0.02'],
      checks: ['rate>0.98'],
    },
  },
  '10k': {
    label: 'Upper planning target: 10,000 users',
    expectedUsers: 10000,
    vus: 300,
    duration: '12m',
    thresholds: {
      http_req_duration: ['p(95)<4000', 'p(99)<8000'],
      http_req_failed: ['rate<0.05'],
      checks: ['rate>0.95'],
    },
  },
};

export function normalizeScalabilityTarget(value: string | undefined): ScalabilityTarget {
  return value === '5k' || value === '10k' ? value : '1k';
}

export function buildScalabilityOptions(target: ScalabilityTarget) {
  const profile = SCALABILITY_TARGETS[target];
  return {
    scenarios: {
      steady_read_write_mix: {
        executor: 'constant-vus',
        vus: profile.vus,
        duration: profile.duration,
      },
    },
    thresholds: profile.thresholds,
    tags: {
      scalabilityTarget: target,
      expectedUsers: String(profile.expectedUsers),
    },
  };
}
