import { describe, expect, it } from 'vitest';
import {
  scanStudentIdentityArchitecture,
  type StudentIdentityArchitecturePolicy,
  type StudentIdentityArchitectureViolationCode,
} from './student-identity-architecture.js';

function scan(
  source: string,
  policy: StudentIdentityArchitecturePolicy = 'pre-cutover',
  allowlist: Parameters<typeof scanStudentIdentityArchitecture>[0]['allowlist'] = []
) {
  return scanStudentIdentityArchitecture({
    policy,
    files: [{ path: 'server/api/example.ts', source }],
    allowlist,
  });
}

function codes(source: string, policy?: StudentIdentityArchitecturePolicy) {
  return scan(source, policy).map((violation) => violation.code);
}

describe('scanStudentIdentityArchitecture', () => {
  it('rejects a linked-user class query, which is the one that fails silently', () => {
    // Retirement deletes `users.classId`. A reader of it returns an empty
    // recipient set — no error, no failed job, no alert — and assignment
    // delivery simply stops.
    const source = `
      export async function recipients(db: any, classId: string) {
        const snap = await db.collection('users').where('classId', '==', classId).get();
        return snap.docs.map((doc: any) => doc.id);
      }
    `;

    expect(codes(source)).toContain('AUTHORITATIVE_LINKED_USER_CLASS_QUERY');
    expect(codes(source, 'post-retirement')).toContain('AUTHORITATIVE_LINKED_USER_CLASS_QUERY');
  });

  it('does not let the students-only rule stand in for the users rule', () => {
    // A scanner scoped to `students` reports a clean pass while realtime
    // delivery is broken.
    const usersOnly = `
      const snap = await db.collection('users').where('classId', '==', classId).get();
    `;

    const found = codes(usersOnly);
    expect(found).toContain('AUTHORITATIVE_LINKED_USER_CLASS_QUERY');
    expect(found).not.toContain('AUTHORITATIVE_PROFILE_CLASS_QUERY');
  });

  it('rejects reading a roster from the profile projection', () => {
    const source = `
      const snap = await db.collection('students').where('classId', '==', classId).get();
    `;

    expect(codes(source)).toContain('AUTHORITATIVE_PROFILE_CLASS_QUERY');
  });

  it('rejects creating a profile with an id nothing else can name', () => {
    const add = `await db.collection('students').add({ name });`;
    const anonymous = `const ref = db.collection('students').doc();`;

    expect(codes(add)).toContain('STUDENT_COLLECTION_ADD');
    expect(codes(anonymous)).toContain('ANONYMOUS_STUDENT_DOCUMENT_CREATE');
  });

  it('allows a profile written under an id the caller chose', () => {
    expect(codes(`const ref = db.collection('students').doc(canonicalProfileId);`)).toEqual([]);
  });

  it('rejects copying a profile into a new document', () => {
    // This is where the fifty-nine doubly-owned codes came from.
    const source = `
      await ref.set({ ...studentData, classId: nextClassId, createdAt: now });
    `;

    expect(codes(source)).toContain('CLONE_BASED_CLASS_PROGRESSION');
  });

  it('rejects writing the promoted status onto a profile', () => {
    const source = `await ref.update({ enrollmentStatus: 'promoted' });`;

    expect(codes(source)).toContain('PROFILE_PROMOTED_STATUS_WRITE');
  });

  it('rejects writing any compatibility projection field', () => {
    const source = `await ref.set({ classId, teacherId, name });`;

    const violation = scan(source).find(
      (entry) => entry.code === 'LEGACY_PROJECTION_FIELD_WRITE'
    );
    expect(violation?.detail).toContain('classId, teacherId');
  });

  it('rejects indirect writes of compatibility projection fields', () => {
    const source = `
      const payload = { classId, teacherId, name };
      await ref.set(payload);
    `;

    const violation = scan(source).find(
      (entry) => entry.code === 'LEGACY_PROJECTION_FIELD_WRITE'
    );
    expect(violation?.detail).toContain('classId, teacherId');
  });

  it('rejects the legacy code fallback and the soft-merge pointer', () => {
    expect(codes(`resolveCanonicalStudentId(db, id, { allowLegacyCodeFallback: true });`)).toContain(
      'LEGACY_CODE_FALLBACK'
    );
    expect(codes(`const target = data.mergedIntoStudentId;`)).toContain(
      'LEGACY_SOFT_MERGE_POINTER_RESOLUTION'
    );
  });

  it('rejects collapsing physical rows in a production surface', () => {
    // These helpers key on name, date of birth, and contact — a guess that is
    // blind to every duplicated pair, because both rows agree on all three.
    for (const helper of [
      'getCurrentStudentRecords',
      'getCurrentStudentRoster',
      'getCurrentStudentHeadcount',
      'getCurrentClassStudentRecords',
    ]) {
      expect(codes(`const rows = ${helper}(students);`)).toContain(
        'AUTHORITATIVE_PRESENTATION_DEDUPE'
      );
    }
  });

  it('does not flag importing the deprecated helper, only calling it', () => {
    // It stays reachable for anomaly reporting, which is a legitimate use.
    const source = `import { getCurrentStudentRecords } from '../../shared/studentRecords.js';`;

    expect(codes(source)).not.toContain('AUTHORITATIVE_PRESENTATION_DEDUPE');
  });
});

describe('the allowlist', () => {
  const source = `const snap = await db.collection('students').where('classId', '==', classId).get();`;

  function fingerprintFor(code: StudentIdentityArchitectureViolationCode) {
    const violation = scan(source).find((entry) => entry.code === code)!;
    return { nodeKind: violation.nodeKind, astFingerprint: violation.astFingerprint };
  }

  it('accepts an exception matching path, node kind, and AST fingerprint', () => {
    const { nodeKind, astFingerprint } = fingerprintFor('AUTHORITATIVE_PROFILE_CLASS_QUERY');

    expect(
      scan(source, 'pre-cutover', [
        {
          policy: 'pre-cutover',
          path: 'server/api/example.ts',
          nodeKind,
          astFingerprint,
          reason: 'legacy_compare',
        },
      ])
    ).toEqual([]);
  });

  it('stops accepting the exception the moment the code changes', () => {
    // A line-number exception moves when somebody adds an import above it; a
    // text exception matches a string that means something else next month.
    // Editing the code must force a fresh look.
    const { nodeKind, astFingerprint } = fingerprintFor('AUTHORITATIVE_PROFILE_CLASS_QUERY');
    const edited = `const snap = await db.collection('students').where('classId', '==', otherClassId).get();`;

    const remaining = scanStudentIdentityArchitecture({
      policy: 'pre-cutover',
      files: [{ path: 'server/api/example.ts', source: edited }],
      allowlist: [
        {
          policy: 'pre-cutover',
          path: 'server/api/example.ts',
          nodeKind,
          astFingerprint,
          reason: 'legacy_compare',
        },
      ],
    });

    expect(remaining.map((entry) => entry.code)).toContain('AUTHORITATIVE_PROFILE_CLASS_QUERY');
  });

  it('does not accept an exception written for a different file', () => {
    const { nodeKind, astFingerprint } = fingerprintFor('AUTHORITATIVE_PROFILE_CLASS_QUERY');

    expect(
      scan(source, 'pre-cutover', [
        {
          policy: 'pre-cutover',
          path: 'server/api/somewhere-else.ts',
          nodeKind,
          astFingerprint,
          reason: 'legacy_compare',
        },
      ]).map((entry) => entry.code)
    ).toContain('AUTHORITATIVE_PROFILE_CLASS_QUERY');
  });

  it('ignores the allowlist entirely after retirement', () => {
    // An exception there would describe code reading something no longer
    // written, so the list stops applying rather than being emptied by hand.
    const { nodeKind, astFingerprint } = fingerprintFor('AUTHORITATIVE_PROFILE_CLASS_QUERY');

    expect(
      scan(source, 'post-retirement', [
        {
          policy: 'pre-cutover',
          path: 'server/api/example.ts',
          nodeKind,
          astFingerprint,
          reason: 'legacy_compare',
        },
      ]).map((entry) => entry.code)
    ).toContain('AUTHORITATIVE_PROFILE_CLASS_QUERY');
  });
});

describe('the repository under the pre-cutover policy', () => {
  it('is clean, so a new violation fails the suite rather than waiting for CI', async () => {
    // Measured at roughly two seconds over the whole repository. That is cheap
    // enough to run here as well as in CI, and not cheap enough to justify
    // putting a whole-repository AST scan on the critical path of every
    // deployment — so there is no prebuild hook.
    const { runStudentIdentityArchitectureCheck } = await import(
      './check-student-identity-architecture.js'
    );
    const { violations } = runStudentIdentityArchitectureCheck(['--policy', 'pre-cutover']);

    expect(
      violations.map((entry) => `${entry.path}:${entry.line} ${entry.code}`)
    ).toEqual([]);
  });

  it('holds no serving-path exception labelled as an anomaly report', async () => {
    // Twelve of these existed. `Students.tsx` renders the directory and
    // `ClassDetail.tsx` renders a roster; neither reports an anomaly, and
    // filing them under that reason is how the gate stayed green while the
    // pages were still deciding which physical rows were the same child. The
    // scan is clean without them now, so the assertion is what stops them
    // coming back one convenient edit at a time.
    const { STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST } = await import(
      './student-identity-architecture-allowlist.js'
    );
    const servingPrefixes = [
      'src/pages/',
      'src/components/',
      'src/lib/exports/',
      'src/lib/reports/',
      'src/lib/student/',
    ];

    expect(
      STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST.filter(
        (entry) =>
          entry.reason === 'anomaly_report' &&
          servingPrefixes.some((prefix) => entry.path.startsWith(prefix))
      )
    ).toEqual([]);
  });

  it('rejects a serving file that imports the dedupe helper with no exception', () => {
    // The fixture that keeps the rule real: an allowlist edit alone cannot
    // restore serving authority without this failing first.
    const violations = scan(
      `import { getCurrentStudentRecords } from '../student/currentRecords';
       export function rows(students: unknown[]) {
         return getCurrentStudentRecords(students as never);
       }`
    );

    expect(violations.map((entry) => entry.code)).toContain('AUTHORITATIVE_PRESENTATION_DEDUPE');
  });

  it('still refuses the legacy behaviours once retirement has removed the fields', async () => {
    // The allowlist stops applying rather than being emptied by hand: an
    // exception there would describe code reading something no longer written.
    const { runStudentIdentityArchitectureCheck } = await import(
      './check-student-identity-architecture.js'
    );
    const { violations } = runStudentIdentityArchitectureCheck(['--policy', 'post-retirement']);

    expect(violations.length).toBeGreaterThan(0);
  });
});
