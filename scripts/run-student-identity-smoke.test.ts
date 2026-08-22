import { describe, expect, it, vi } from 'vitest';
import {
  runStudentIdentitySmoke,
  CUTOVER_SMOKE_SURFACES,
  assertNoSmokeSecrets,
  digestSmokeEvidence,
  sealStudentIdentitySmokeEvidence,
  validateStudentIdentitySmokeEvidence,
  parseRunStudentIdentitySmokeArgs,
  main,
  type CutoverSmokeSurface,
} from './run-student-identity-smoke.js';

const NOW = new Date('2026-08-09T10:00:00.000Z');

const EXPECTED = {
  runId: 'run-1',
  projectId: 'edutrack',
  databaseId: '(default)',
  planDigest: 'p'.repeat(64),
  approvalDigest: 'q'.repeat(64),
  sourceCommitSha: 'abc1234',
  exportOperationId: 'export-1',
  projectionHealthId: 'proj-1',
};

function results(
  overrides: Partial<Record<CutoverSmokeSurface, { status: 'pass' | 'fail'; reasonCode?: string }>> = {}
) {
  return Object.fromEntries(
    CUTOVER_SMOKE_SURFACES.map((surface) => {
      const override = overrides[surface];
      return [
        surface,
        {
          status: override?.status ?? 'pass',
          statusCode: override?.status === 'fail' ? 500 : 200,
          reasonCode: override?.reasonCode ?? 'OK',
          responseShapeDigest: 's'.repeat(64),
        },
      ];
    })
  ) as Record<CutoverSmokeSurface, { status: 'pass' | 'fail'; statusCode: number; reasonCode: string; responseShapeDigest: string }>;
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2 as const,
    evidenceId: 'smoke-1',
    runId: 'run-1',
    target: { projectId: 'edutrack', databaseId: '(default)' },
    planDigest: EXPECTED.planDigest,
    approvalDigest: EXPECTED.approvalDigest,
    sourceCommitSha: 'abc1234',
    exportOperationId: 'export-1',
    canonicalReadMode: 'canonical_required' as const,
    projectionHealthId: 'proj-1',
    operationCounts: { planned: 12, applied: 12, verified: 12, failed: 0 },
    pendingJobCounts: { outboxJobs: 0, zaloBulkJobs: 0 },
    startedAt: '2026-08-09T09:50:00.000Z',
    executedAt: '2026-08-09T09:55:00.000Z',
    runnerVersion: '2.0.0',
    results: results(),
    mutationGuardProbes: [
      { surface: 'students:create', statusCode: 503 as const, reasonCode: 'STUDENT_IDENTITY_MAINTENANCE' as const },
    ],
    ...overrides,
  };
}

function validate(overrides: Record<string, unknown> = {}, now = NOW) {
  return validateStudentIdentitySmokeEvidence({
    evidence: evidence(overrides) as never,
    expected: EXPECTED,
    now,
  });
}

describe('validateStudentIdentitySmokeEvidence', () => {
  it('is green when every surface passed and every mutation was refused', () => {
    expect(validate()).toEqual({ status: 'green', blockers: [] });
  });

  it('rejects a surface nobody probed', () => {
    const partial = results();
    delete (partial as Record<string, unknown>).wallet;

    expect(validate({ results: partial }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_SURFACE_MISSING: wallet'
    );
  });

  it('treats realtime recipients as a surface of its own', () => {
    expect(CUTOVER_SMOKE_SURFACES).toContain('realtime_recipients');

    const failed = validate({
      results: results({ realtime_recipients: { status: 'fail', reasonCode: 'EMPTY_RECIPIENTS' } }),
    });

    expect(failed.status).toBe('red');
    expect(failed.blockers.join()).toContain('realtime_recipients');
  });

  it('rejects a mutation the guard let through', () => {
    const leaked = validate({
      mutationGuardProbes: [
        { surface: 'students:create', statusCode: 201, reasonCode: 'STUDENT_IDENTITY_MAINTENANCE' },
      ],
    });

    expect(leaked.blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_MUTATION_NOT_BLOCKED: students:create'
    );
  });

  it('rejects a run that probed no mutations at all', () => {
    expect(validate({ mutationGuardProbes: [] }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_NO_MUTATION_PROBES'
    );
  });

  it('rejects evidence older than an hour', () => {
    const stale = validate({}, new Date('2026-08-09T11:30:00.000Z'));

    expect(stale.blockers).toContain('STUDENT_IDENTITY_SMOKE_EVIDENCE_STALE');
  });

  it('rejects evidence bound to a different run, target, or artifact', () => {
    expect(validate({ runId: 'run-2' }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: runId'
    );
    expect(validate({ target: { projectId: 'other', databaseId: '(default)' } }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: projectId'
    );
    expect(validate({ planDigest: 'z'.repeat(64) }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: planDigest'
    );
    expect(validate({ exportOperationId: 'other' }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: exportOperationId'
    );
    expect(validate({ projectionHealthId: 'other' }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_BINDING_MISMATCH: projectionHealthId'
    );
  });

  it('rejects a run taken while reads were not canonical_required', () => {
    expect(validate({ canonicalReadMode: 'canonical_preferred' }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_READ_MODE_NOT_REQUIRED'
    );
  });

  it('rejects a failed operation or an undrained queue', () => {
    expect(
      validate({ operationCounts: { planned: 12, applied: 12, verified: 11, failed: 1 } }).blockers
    ).toContain('STUDENT_IDENTITY_SMOKE_OPERATIONS_FAILED');
    expect(validate({ pendingJobCounts: { outboxJobs: 2 } }).blockers).toContain(
      'STUDENT_IDENTITY_SMOKE_QUEUE_NOT_DRAINED: outboxJobs'
    );
  });
});

describe('smoke evidence handling', () => {
  it('refuses to seal evidence carrying a credential or token', () => {
    expect(() =>
      assertNoSmokeSecrets({ headers: { authorization: 'Bearer abc' } })
    ).toThrow('STUDENT_IDENTITY_SMOKE_SECRET_FORBIDDEN');

    expect(() => assertNoSmokeSecrets({ note: 'api_key rotated' })).toThrow(
      'STUDENT_IDENTITY_SMOKE_SECRET_FORBIDDEN'
    );
  });

  it('digests the same run to the same value regardless of key order', () => {
    const body = { ...evidence(), status: 'green' as const, blockers: [] as string[] };
    const reordered = Object.fromEntries(Object.entries(body).reverse()) as typeof body;

    expect(digestSmokeEvidence(body as never)).toBe(digestSmokeEvidence(reordered as never));
  });

  it('seals a green run with its digest', () => {
    const sealed = sealStudentIdentitySmokeEvidence({
      evidence: evidence() as never,
      expected: EXPECTED,
      now: NOW,
    });

    expect(sealed.status).toBe('green');
    expect(sealed.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('seals a red run rather than throwing, so the failure is on record', () => {
    const sealed = sealStudentIdentitySmokeEvidence({
      evidence: evidence({ results: results({ wallet: { status: 'fail' } }) }) as never,
      expected: EXPECTED,
      now: NOW,
    });

    expect(sealed.status).toBe('red');
    expect(sealed.blockers.join()).toContain('wallet');
  });
});

describe('parseRunStudentIdentitySmokeArgs', () => {
  it('does not accept caller-supplied results', () => {
    expect(() =>
      parseRunStudentIdentitySmokeArgs(['--run-id', 'run-1', '--results', 'fabricated.json'])
    ).toThrow('Caller-supplied --results are forbidden');
  });

  it('parses valid options successfully', () => {
    const opts = parseRunStudentIdentitySmokeArgs([
      '--run-id', 'run-1',
      '--plan-digest', 'plan1',
      '--approval-digest', 'app1',
      '--export-operation-id', 'exp1',
      '--projection-health-id', 'proj1',
      '--output', 'out.json',
    ]);
    expect(opts.runId).toBe('run-1');
    expect(opts.planDigest).toBe('plan1');
    expect(opts.outputPath).toBe('out.json');
  });
});

describe('main', () => {
  it('handles help and returns 0', async () => {
    const runtime = {
      env: {},
      now: () => NOW,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      openDocumentStore: vi.fn(),
      readText: vi.fn(),
      writeTextAtomic: vi.fn(),
    };
    const code = await main(['--help'], runtime as any);
    expect(code).toBe(0);
  });
});

describe('runStudentIdentitySmoke refuses to fabricate evidence', () => {
  const OPTIONS = {
    mode: 'cutover' as const,
    runId: 'run-1',
    planDigest: 'p'.repeat(64),
    approvalDigest: 'a'.repeat(64),
    exportOperationId: 'export-1',
    projectionHealthId: 'rebuild-1',
    sourceCommit: 'abc1234',
    write: false,
    assertGreen: false,
  };

  function runtimeFor(env: Record<string, string> = {}) {
    return {
      env,
      now: () => NOW,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      openDocumentStore: vi.fn(),
      readText: vi.fn(),
      writeTextAtomic: vi.fn(),
    } as never;
  }

  it('refuses to run without a real base URL and bearer token', async () => {
    // Probing http://localhost:3000 with "mock-token" produces evidence about
    // nothing, and the release gate cannot tell that apart from the real run.
    await expect(
      runStudentIdentitySmoke(OPTIONS, runtimeFor())
    ).rejects.toThrow('STUDENT_IDENTITY_SMOKE_TARGET_NOT_CONFIGURED');
  });

  it('probes the configured surface instead of answering for it', async () => {
    const seen: string[] = [];
    const evidence = await runStudentIdentitySmoke(
      OPTIONS,
      runtimeFor({
        STUDENT_IDENTITY_SMOKE_BASE_URL: 'https://edutrack.example',
        STUDENT_IDENTITY_SMOKE_BEARER_TOKEN: 'real-token',
        STUDENT_IDENTITY_SMOKE_STUDENT_ID: 'student-1',
        STUDENT_IDENTITY_SMOKE_CLASS_ID: 'class-1',
      }),
      undefined,
      {
        adapter: {
          read: async (probe: { path?: string; id?: string }) => {
            seen.push(String(probe.path ?? probe.id));
            return { statusCode: 200, body: { status: 'ok' } };
          },
          mutate: async () => ({
            statusCode: 503,
            body: { code: 'STUDENT_IDENTITY_MAINTENANCE' },
          }),
          realtimeRecipients: async () => ({ actual: ['user-1'], expected: ['user-1'] }),
        },
        target: { projectId: 'edutrack', databaseId: '(default)' },
        operationCounts: { planned: 3, applied: 3, verified: 3, failed: 0 },
        pendingJobCounts: { outboxJobs: 0 },
      }
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(evidence.operationCounts).toMatchObject({ planned: 3, applied: 3, verified: 3 });
    expect(evidence.target).toMatchObject({ projectId: 'edutrack' });
  });
});
