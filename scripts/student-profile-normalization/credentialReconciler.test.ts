import { describe, expect, it } from 'vitest';
import { summarizeLinkedUser, summarizeStudentCredential } from './authSources.js';
import { reconcileStudentCredentialsAndUsers } from './credentialReconciler.js';

const MATERIAL_A = {
  loginPasswordSalt: 'salt-a',
  loginPasswordHash: 'hash-a',
  passwordVersion: 1,
  updatedAt: '2026-06-01T00:00:00.000Z',
};
const MATERIAL_B = {
  loginPasswordSalt: 'salt-b',
  loginPasswordHash: 'hash-b',
  passwordVersion: 3,
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    canonicalProfileId: 'canonical-1',
    credentials: [
      summarizeStudentCredential('canonical-1', null),
      summarizeStudentCredential('legacy-1', null),
    ],
    linkedUsers: [],
    ...overrides,
  } as Parameters<typeof reconcileStudentCredentialsAndUsers>[0];
}

describe('credential selection', () => {
  it('reports no credential rather than holding the group when nobody has one', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(input());

    // A hold here would block a merge for a student who simply has no password.
    expect(decision.action).toBe('none');
    expect(blockers).toEqual([]);
  });

  it('uses the sole credential wherever it sits', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', null),
          summarizeStudentCredential('legacy-1', MATERIAL_A),
        ],
      })
    );

    expect(decision).toMatchObject({
      action: 'use_profile',
      sourceProfileId: 'legacy-1',
      evidenceCode: 'sole_credential',
    });
    expect(blockers).toEqual([]);
  });

  it('does not hold when both credentials carry identical material', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', { ...MATERIAL_A }),
        ],
      })
    );

    expect(decision).toMatchObject({
      action: 'use_profile',
      sourceProfileId: 'canonical-1',
      evidenceCode: 'identical_material',
    });
    expect(blockers).toEqual([]);
  });

  it('holds two differing credentials instead of picking the newer one', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', MATERIAL_B),
        ],
      })
    );

    // This is the HS260167 shape. A newer timestamp is not evidence of which
    // password the family actually uses.
    expect(decision).toMatchObject({ action: 'hold', reasonCode: 'CREDENTIAL_AMBIGUOUS' });
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'CREDENTIAL_AMBIGUOUS' }));
  });

  it('accepts evidenced current-login selection over an ambiguous pair', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', MATERIAL_B),
        ],
        evidencedCurrentLoginProfileId: 'legacy-1',
      })
    );

    expect(decision).toMatchObject({
      action: 'use_profile',
      sourceProfileId: 'legacy-1',
      evidenceCode: 'evidenced_current_login',
    });
    expect(blockers).toEqual([]);
  });

  it('refuses evidence naming a profile that holds no credential', () => {
    const { decision, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', MATERIAL_B),
        ],
        evidencedCurrentLoginProfileId: 'someone-else',
      })
    );

    expect(decision.action).toBe('hold');
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'CREDENTIAL_AMBIGUOUS' }));
  });

  it('records an approved forced reset without exporting any material', () => {
    const result = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', MATERIAL_B),
        ],
        forcedReset: { approvedBy: 'admin:tt', reason: 'family confirmed by phone' },
      })
    );

    expect(result.decision).toMatchObject({ action: 'force_reset', approvedBy: 'admin:tt' });
    expect(result.blockers).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('hash-a');
    expect(JSON.stringify(result)).not.toContain('salt-b');
  });

  it('retains the non-selected credential as an inaccessible tombstone operation', () => {
    const { operations } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', null),
          summarizeStudentCredential('legacy-1', MATERIAL_A),
        ],
      })
    );

    // The selected credential lives under a legacy id, so it must be copied to
    // the canonical id AND the original kept. Never delete during the merge: a
    // wrong selection must stay recoverable until retirement, 30 days later.
    expect(operations).toContainEqual(
      expect.objectContaining({
        sourcePath: 'student_auth_credentials/legacy-1',
        targetPath: 'student_auth_credentials/canonical-1',
        kind: 'recreate_document',
      })
    );
    expect(operations).toContainEqual(
      expect.objectContaining({
        sourcePath: 'student_auth_credentials/legacy-1',
        kind: 'retain_inaccessible',
      })
    );
  });

  it('emits no credential move when the selected record already sits on the canonical id', () => {
    const { operations } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', null),
        ],
      })
    );

    expect(operations).toEqual([]);
  });

  it('retains a non-selected credential without moving it', () => {
    const { operations } = reconcileStudentCredentialsAndUsers(
      input({
        credentials: [
          summarizeStudentCredential('canonical-1', MATERIAL_A),
          summarizeStudentCredential('legacy-1', MATERIAL_B),
        ],
        evidencedCurrentLoginProfileId: 'canonical-1',
      })
    );

    expect(operations).toEqual([
      expect.objectContaining({
        sourcePath: 'student_auth_credentials/legacy-1',
        kind: 'retain_inaccessible',
        targetPath: null,
      }),
    ]);
  });
});

describe('linked user reconciliation', () => {
  it('moves a legacy student account onto the canonical id', () => {
    const { operations, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [summarizeLinkedUser('student:legacy-1', { studentId: 'legacy-1' })],
      })
    );

    expect(blockers).toEqual([]);
    expect(operations).toContainEqual(
      expect.objectContaining({
        sourcePath: 'users/student:legacy-1',
        targetPath: 'users/student:canonical-1',
        kind: 'recreate_document',
      })
    );
  });

  it('plans a user whose field was already repointed but whose id was not', () => {
    // A field query for studentId == 'legacy-1' would not return this document,
    // which is how the earlier partial fix left accounts stranded.
    const { operations } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [summarizeLinkedUser('parent:legacy-1', { studentId: 'canonical-1' })],
      })
    );

    expect(operations).toContainEqual(
      expect.objectContaining({
        sourcePath: 'users/parent:legacy-1',
        targetPath: 'users/parent:canonical-1',
      })
    );
  });

  it('emits nothing for an account already at its canonical id', () => {
    const { operations, blockers } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [summarizeLinkedUser('student:canonical-1', { studentId: 'canonical-1' })],
      })
    );

    expect(blockers).toEqual([]);
    expect(operations).toEqual([]);
  });

  it('blocks two live accounts of the same role targeting one canonical id', () => {
    const { blockers } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [
          summarizeLinkedUser('student:canonical-1', { studentId: 'canonical-1' }),
          summarizeLinkedUser('student:legacy-1', { studentId: 'legacy-1' }),
        ],
      })
    );

    expect(blockers).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_ROLE_ACCOUNT' }));
  });

  it('ignores a revoked duplicate rather than blocking on it', () => {
    const { blockers, operations } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [
          summarizeLinkedUser('student:canonical-1', { studentId: 'canonical-1' }),
          summarizeLinkedUser('student:legacy-1', { studentId: 'legacy-1', isRevoked: true }),
        ],
      })
    );

    expect(blockers).toEqual([]);
    expect(operations).toEqual([]);
  });

  it('blocks an account whose role it cannot recognize instead of skipping it', () => {
    const { blockers } = reconcileStudentCredentialsAndUsers(
      input({
        linkedUsers: [summarizeLinkedUser('teacher:legacy-1', { studentId: 'legacy-1' })],
      })
    );

    expect(blockers).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_LINKED_ROLE' }));
  });

  it('is deterministic under shuffled input order', () => {
    const users = [
      summarizeLinkedUser('parent:legacy-1', { studentId: 'legacy-1' }),
      summarizeLinkedUser('student:legacy-1', { studentId: 'legacy-1' }),
    ];
    const forward = reconcileStudentCredentialsAndUsers(input({ linkedUsers: users }));
    const backward = reconcileStudentCredentialsAndUsers(
      input({ linkedUsers: [...users].reverse() })
    );

    expect(forward.operations).toEqual(backward.operations);
  });
});
