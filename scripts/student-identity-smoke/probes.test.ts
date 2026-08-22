import { describe, expect, it, vi } from 'vitest';
import {
  runStudentIdentitySmokeProbes,
  REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES,
  type SmokeFixture,
  type SmokeProbeAdapter,
} from './probes.js';
import { CUTOVER_SMOKE_SURFACES } from '../run-student-identity-smoke.js';

function fakeSmokeAdapter(): SmokeProbeAdapter {
  return {
    read: vi.fn(async () => ({ statusCode: 200, body: { success: true } })),
    mutate: vi.fn(async () => ({ statusCode: 503, body: { error: 'STUDENT_IDENTITY_MAINTENANCE' } })),
    realtimeRecipients: vi.fn(async () => ({ actual: ['user-1'], expected: ['user-1'] })),
  };
}

function smokeFixture(): SmokeFixture {
  return {
    baseUrl: 'https://example.com',
    bearerToken: 'test-token',
    studentId: 'student-1',
    classId: 'class-1',
  };
}

describe('runStudentIdentitySmokeProbes', () => {
  it('executes every required read and mutation probe exactly once', async () => {
    const adapter = fakeSmokeAdapter();
    const observed = await runStudentIdentitySmokeProbes(smokeFixture(), adapter);

    expect(adapter.read).toHaveBeenCalledTimes(CUTOVER_SMOKE_SURFACES.length - 1); // 9 HTTP reads + 1 realtimeRecipients
    expect(adapter.mutate).toHaveBeenCalledTimes(REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES.length);
    expect(Object.keys(observed.results).sort()).toEqual([...CUTOVER_SMOKE_SURFACES].sort());
    expect(observed.mutationGuardProbes.map((probe) => probe.probeId).sort()).toEqual(
      REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES.map((probe) => probe.id).sort()
    );
  });
});
