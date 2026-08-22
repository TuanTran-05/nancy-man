import { createHash } from 'node:crypto';
import {
  CUTOVER_SMOKE_SURFACES,
  type CutoverSmokeResult,
  type CutoverSmokeSurface,
  assertNoSmokeSecrets,
} from '../run-student-identity-smoke.js';

export type ReadProbe = {
  surface: CutoverSmokeSurface;
  path: string;
  method: 'GET';
};

export type MutationProbe = {
  id: string;
  surface: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: Record<string, unknown>;
};

export const REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES: readonly MutationProbe[] = [
  {
    id: 'students:create',
    surface: 'students:create',
    path: '/api/v1/students',
    method: 'POST',
    payload: { name: 'Smoke Test' },
  },
  {
    id: 'students:update',
    surface: 'students:update',
    path: '/api/v1/students',
    method: 'PUT',
    payload: { studentId: 'smoke-id', name: 'Smoke Update' },
  },
  {
    id: 'students:status',
    surface: 'students:status',
    path: '/api/v1/students/status',
    method: 'PATCH',
    payload: { studentId: 'smoke-id', status: 'active' },
  },
  {
    id: 'admissions:create-trial',
    surface: 'admissions:create-trial',
    path: '/api/v1/admissions/create-trial',
    method: 'POST',
    payload: { studentName: 'Trial Smoke' },
  },
  {
    id: 'attendance:toggle',
    surface: 'attendance:toggle',
    path: '/api/v1/attendance/toggle',
    method: 'POST',
    payload: { studentId: 'smoke-id', date: '2026-08-09' },
  },
];

export type SmokeFixture = {
  baseUrl: string;
  bearerToken: string;
  studentId: string;
  classId: string;
};

export type SmokeProbeAdapter = {
  read: (probe: ReadProbe, fixture: SmokeFixture) => Promise<{ statusCode: number; body: unknown }>;
  mutate: (probe: MutationProbe, fixture: SmokeFixture) => Promise<{ statusCode: number; body: unknown }>;
  realtimeRecipients: (classId: string) => Promise<{ actual: string[]; expected: string[] }>;
};

export function responseShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [responseShape(value[0])];
  if (!value || typeof value !== 'object') return typeof value;
  return Object.fromEntries(
    Object.keys(value as object).sort().map((key) => [
      key,
      responseShape((value as Record<string, unknown>)[key]),
    ])
  );
}

export function shapeDigest(value: unknown): string {
  const shape = responseShape(value);
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export async function runStudentIdentitySmokeProbes(
  fixture: SmokeFixture,
  adapter: SmokeProbeAdapter
): Promise<{
  results: Record<CutoverSmokeSurface, CutoverSmokeResult>;
  mutationGuardProbes: Array<{
    probeId: string;
    surface: string;
    statusCode: 503;
    reasonCode: 'STUDENT_IDENTITY_MAINTENANCE';
  }>;
}> {
  const results: Partial<Record<CutoverSmokeSurface, CutoverSmokeResult>> = {};

  const READ_PROBES: ReadProbe[] = [
    { surface: 'auth', path: '/api/v1/auth/me', method: 'GET' },
    { surface: 'profile', path: `/api/v1/students/${fixture.studentId}`, method: 'GET' },
    { surface: 'class_roster', path: `/api/v1/classes/${fixture.classId}/roster`, method: 'GET' },
    { surface: 'attendance', path: `/api/v1/attendance?classId=${fixture.classId}`, method: 'GET' },
    { surface: 'wallet', path: `/api/v1/students/${fixture.studentId}/wallet`, method: 'GET' },
    { surface: 'receipt', path: `/api/v1/finance/receipts?studentId=${fixture.studentId}`, method: 'GET' },
    { surface: 'invoice', path: `/api/v1/finance/invoices?studentId=${fixture.studentId}`, method: 'GET' },
    { surface: 'payment', path: `/api/v1/finance/payments?studentId=${fixture.studentId}`, method: 'GET' },
    { surface: 'reporting', path: `/api/v1/finance/summary?studentId=${fixture.studentId}`, method: 'GET' },
  ];

  for (const probe of READ_PROBES) {
    const res = await adapter.read(probe, fixture);
    assertNoSmokeSecrets(res.body);
    results[probe.surface] = {
      status: res.statusCode >= 200 && res.statusCode < 300 ? 'pass' : 'fail',
      statusCode: res.statusCode,
      reasonCode: res.statusCode >= 200 && res.statusCode < 300 ? 'OK' : `HTTP_${res.statusCode}`,
      responseShapeDigest: shapeDigest(res.body),
    };
  }

  // Probe realtime recipients surface
  const rr = await adapter.realtimeRecipients(fixture.classId);
  const rrPass =
    rr.actual.length > 0 &&
    rr.actual.length === rr.expected.length &&
    rr.actual.every((id, idx) => id === rr.expected[idx]);
  results['realtime_recipients'] = {
    status: rrPass ? 'pass' : 'fail',
    statusCode: rrPass ? 200 : 500,
    reasonCode: rrPass ? 'OK' : 'RECIPIENTS_MISMATCH',
    responseShapeDigest: shapeDigest(rr.actual),
  };

  const mutationGuardProbes: Array<{
    probeId: string;
    surface: string;
    statusCode: 503;
    reasonCode: 'STUDENT_IDENTITY_MAINTENANCE';
  }> = [];

  for (const probe of REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES) {
    const res = await adapter.mutate(probe, fixture);
    assertNoSmokeSecrets(res.body);
    if (res.statusCode === 503) {
      mutationGuardProbes.push({
        probeId: probe.id,
        surface: probe.surface,
        statusCode: 503,
        reasonCode: 'STUDENT_IDENTITY_MAINTENANCE',
      });
    }
  }

  return {
    results: results as Record<CutoverSmokeSurface, CutoverSmokeResult>,
    mutationGuardProbes,
  };
}
