import { describe, expect, it } from 'vitest';
import {
  claimStudentCodeInTransaction,
  demoteStudentCodePrimaryInTransaction,
  normalizeStudentCode,
  reassignStudentCodeForMergeInTransaction,
  readStudentCodeClaimInTransaction,
  retireStudentCodeInTransaction,
  STUDENT_CODE_REGISTRY_COLLECTION,
  type StudentCodeRegistryRecord,
} from './studentCodeRegistry.js';

function record(overrides: Partial<StudentCodeRegistryRecord> = {}): StudentCodeRegistryRecord {
  return {
    normalizedCode: 'HS260167',
    canonicalProfileId: 'canonical-1',
    isPrimary: true,
    status: 'active',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    createdBy: 'admin:tt',
    updatedBy: 'admin:tt',
    ...overrides,
  };
}

/**
 * Records the order of reads and writes, because "reads before writes" is a
 * DocumentStore transaction requirement and a correctness one: a claim decided
 * from data read after staging a write is not serialized against anything.
 */
function makeTx(docs: Record<string, unknown>, legacyOwners: string[] = []) {
  const log: string[] = [];
  const tx = {
    log,
    async get(target: { path?: string; __query?: string }) {
      if (target.__query) {
        log.push(`read:${target.__query}`);
        return {
          empty: legacyOwners.length === 0,
          docs: legacyOwners.map((id) => ({ id, data: () => ({ studentId: 'HS260167' }) })),
        };
      }
      log.push(`read:${target.path}`);
      const data = docs[target.path!];
      return { exists: data !== undefined, id: target.path!.split('/').pop(), data: () => data };
    },
    set(ref: { path: string }, value: unknown) {
      log.push(`write:${ref.path}`);
      docs[ref.path] = value;
    },
    update(ref: { path: string }, patch: Record<string, unknown>) {
      log.push(`write:${ref.path}`);
      docs[ref.path] = { ...(docs[ref.path] as object), ...patch };
    },
  };
  return { tx, docs, log };
}

function makeDb() {
  return {
    doc(path: string) {
      return { path };
    },
    collection(name: string) {
      return {
        where(field: string, op: string, value: unknown) {
          return { __query: `${name}.${field}${op}${String(value)}` };
        },
      };
    },
  };
}

describe('normalizeStudentCode', () => {
  it.each([
    ['  hs260167  ', 'HS260167'],
    ['hs 260 167', 'HS260167'],
    ['hs\u00a0260167', 'HS260167'],
    ['ＨＳ２６０１６７', 'HS260167'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeStudentCode(input)).toBe(expected);
  });

  it('uppercases without locale surprises', () => {
    // A Turkish locale would map 'i' to a dotted capital and split one code
    // into two registry documents.
    expect(normalizeStudentCode('hsi260')).toBe('HSI260');
  });

  it.each(['', '   ', null, undefined, 42])('rejects the empty or non-string %j', (value) => {
    expect(() => normalizeStudentCode(value)).toThrow('STUDENT_CODE_INVALID');
  });

  it('rejects a slash, which would silently become a subcollection path', () => {
    expect(() => normalizeStudentCode('HS/260')).toThrow('STUDENT_CODE_INVALID');
  });

  it('rejects control characters', () => {
    expect(() => normalizeStudentCode('HS\u0000260')).toThrow('STUDENT_CODE_INVALID');
  });

  it('rejects a code longer than 64 code points', () => {
    expect(() => normalizeStudentCode('H'.repeat(65))).toThrow('STUDENT_CODE_INVALID');
  });
});

describe('read before write', () => {
  it('reads the registry and the legacy owners before any write is staged', async () => {
    const { tx, log } = makeTx({});
    const db = makeDb();

    const preloaded = await readStudentCodeClaimInTransaction(tx as never, db as never, {
      normalizedCode: 'HS260167',
      canonicalProfileId: 'canonical-1',
    });
    claimStudentCodeInTransaction(
      tx as never,
      db as never,
      {
        normalizedCode: 'HS260167',
        canonicalProfileId: 'canonical-1',
        actorId: 'admin:tt',
        isPrimary: true,
        status: 'active',
      },
      preloaded
    );

    const firstWrite = log.findIndex((entry) => entry.startsWith('write:'));
    const lastRead = log.map((e) => e.startsWith('read:')).lastIndexOf(true);
    expect(lastRead).toBeLessThan(firstWrite);
    expect(log.filter((e) => e.startsWith('read:'))).toHaveLength(2);
  });
});

describe('claim semantics', () => {
  function claim(
    docs: Record<string, unknown>,
    legacyOwners: string[],
    input: Partial<Parameters<typeof claimStudentCodeInTransaction>[2]> = {}
  ) {
    const { tx, docs: store } = makeTx(docs, legacyOwners);
    const db = makeDb();
    const full = {
      normalizedCode: 'HS260167',
      canonicalProfileId: 'canonical-1',
      actorId: 'admin:tt',
      isPrimary: true,
      status: 'active' as const,
      ...input,
    };
    return readStudentCodeClaimInTransaction(tx as never, db as never, full).then((preloaded) => {
      claimStudentCodeInTransaction(tx as never, db as never, full, preloaded);
      return store;
    });
  }

  it('creates a registry document when the code is free', async () => {
    const store = await claim({}, []);

    expect(store[`${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`]).toMatchObject({
      normalizedCode: 'HS260167',
      canonicalProfileId: 'canonical-1',
      status: 'active',
      isPrimary: true,
    });
  });

  it('is an idempotent no-op when the same owner claims again', async () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;
    const store = await claim({ [path]: record() }, ['canonical-1']);

    expect(store[path]).toMatchObject({ canonicalProfileId: 'canonical-1' });
  });

  it('rejects a claim by a different owner', async () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;

    await expect(
      claim({ [path]: record({ canonicalProfileId: 'someone-else' }) }, [])
    ).rejects.toThrow('STUDENT_CODE_ALREADY_CLAIMED');
  });

  it('carries HTTP 409 metadata on a conflict', async () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;
    await expect(
      claim({ [path]: record({ canonicalProfileId: 'someone-else' }) }, [])
    ).rejects.toMatchObject({ status: 409 });
  });

  it('never lets a normal claim move an existing code to a new owner', async () => {
    // Reassignment is a reviewed migration operation, not something an
    // ordinary write path can reach.
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;
    const docs = { [path]: record({ canonicalProfileId: 'original' }) };

    await expect(claim(docs, [], { canonicalProfileId: 'usurper' })).rejects.toThrow(
      'STUDENT_CODE_ALREADY_CLAIMED'
    );
    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('original');
  });

  it('keeps a retired code permanently reserved', async () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;

    await expect(
      claim({ [path]: record({ status: 'retired', canonicalProfileId: 'canonical-1' }) }, [])
    ).rejects.toThrow('STUDENT_CODE_RETIRED');
  });

  it('allows an alias claim for the same canonical profile', async () => {
    const store = await claim({}, [], { isPrimary: false, status: 'alias' });

    expect(store[`${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`]).toMatchObject({
      status: 'alias',
      isPrimary: false,
    });
  });

  it('creates the record when the only legacy owner is the claimant', async () => {
    const store = await claim({}, ['canonical-1']);

    expect(store[`${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`]).toBeDefined();
  });

  it('refuses to create a record while a different legacy profile owns the code', async () => {
    // The registry is empty but production still has students.studentId set.
    // Creating the record here would hand the code to the wrong profile.
    await expect(claim({}, ['some-other-profile'])).rejects.toThrow(
      'STUDENT_CODE_REGISTRY_INCONSISTENT'
    );
  });

  it('refuses when the registry and the legacy owner disagree', async () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;

    await expect(claim({ [path]: record() }, ['a-different-profile'])).rejects.toThrow(
      'STUDENT_CODE_REGISTRY_INCONSISTENT'
    );
  });

  it('stores no personal data', async () => {
    const store = await claim({}, []);
    const serialized = JSON.stringify(store);

    for (const forbidden of ['name', 'dob', 'contact', 'passwordHash', 'guardian']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('migration reassignment', () => {
  const MAINTENANCE = {
    mode: 'read_only' as const,
    activeRunId: 'run-1',
    migrationActorId: 'migration:engine',
    updatedAt: null,
    updatedBy: 'ops',
  };

  function reassign(overrides: Record<string, unknown> = {}) {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;
    const docs: Record<string, unknown> = { [path]: record({ canonicalProfileId: 'legacy-1' }) };
    const { tx } = makeTx(docs);
    const db = makeDb();
    const input = {
      normalizedCode: 'HS260167',
      expectedSourceProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
      expectedRegistryFingerprint: 'r'.repeat(64),
      expectedLegacyProfileFingerprint: 'l'.repeat(64),
      migrationRunId: 'run-1',
      actorId: 'migration:engine',
      ...(overrides.input as object),
    };
    const preloaded = {
      registry: record({ canonicalProfileId: 'legacy-1' }),
      maintenance: MAINTENANCE,
      registryFingerprint: 'r'.repeat(64),
      legacyProfileFingerprint: 'l'.repeat(64),
      ...(overrides.preloaded as object),
    };
    return {
      run: () =>
        reassignStudentCodeForMergeInTransaction(tx as never, db as never, input, preloaded as never),
      docs,
      path,
    };
  }

  it('moves ownership when every proof matches', () => {
    const { run, docs, path } = reassign();

    run();

    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('canonical-1');
  });

  it.each([
    ['registry fingerprint', { preloaded: { registryFingerprint: 'x'.repeat(64) } }],
    ['legacy profile fingerprint', { preloaded: { legacyProfileFingerprint: 'x'.repeat(64) } }],
  ])('writes nothing when the %s drifted', (_label, override) => {
    const { run, docs, path } = reassign(override);

    expect(run).toThrow('STUDENT_CODE_REASSIGN_DRIFT');
    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('legacy-1');
  });

  it('writes nothing when the current owner is not the expected source', () => {
    const { run, docs, path } = reassign({
      preloaded: { registry: record({ canonicalProfileId: 'someone-else' }) },
    });

    expect(run).toThrow('STUDENT_CODE_REASSIGN_OWNER_MISMATCH');
    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('legacy-1');
  });

  it('writes nothing outside the maintenance window', () => {
    const { run, docs, path } = reassign({
      preloaded: { maintenance: { ...MAINTENANCE, mode: 'normal' } },
    });

    expect(run).toThrow('STUDENT_CODE_REASSIGN_MAINTENANCE_REQUIRED');
    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('legacy-1');
  });

  it.each([
    ['actor', { input: { actorId: 'admin:tt' } }],
    ['run', { input: { migrationRunId: 'run-2' } }],
  ])('writes nothing when the %s does not match the active migration', (_label, override) => {
    const { run, docs, path } = reassign(override);

    expect(run).toThrow('STUDENT_CODE_REASSIGN_ACTOR_MISMATCH');
    expect((docs[path] as StudentCodeRegistryRecord).canonicalProfileId).toBe('legacy-1');
  });
});

describe('retirement', () => {
  it('marks a code retired without releasing it', () => {
    const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;
    const docs: Record<string, unknown> = { [path]: record() };
    const { tx } = makeTx(docs);

    retireStudentCodeInTransaction(tx as never, makeDb() as never, {
      normalizedCode: 'HS260167',
      canonicalProfileId: 'canonical-1',
      actorId: 'admin:tt',
    });

    expect(docs[path]).toMatchObject({ status: 'retired', canonicalProfileId: 'canonical-1' });
  });
});

describe('demoting a former primary code', () => {
  const path = `${STUDENT_CODE_REGISTRY_COLLECTION}/HS260167`;

  function demote(
    status: 'alias' | 'retired',
    registry = record(),
    canonicalProfileId = 'canonical-1'
  ) {
    const docs: Record<string, unknown> = { [path]: registry };
    const { tx, log } = makeTx(docs);
    const run = () =>
      demoteStudentCodePrimaryInTransaction(
        tx as never,
        makeDb() as never,
        { normalizedCode: 'HS260167', canonicalProfileId, actorId: 'admin:tt', status },
        { registry }
      );
    return { run, docs, log };
  }

  it.each(['alias', 'retired'] as const)('keeps the owner and clears primary for %s', (status) => {
    const { run, docs } = demote(status);

    run();

    // The record is never deleted. It is what makes an old receipt, an audit
    // entry, or a parent quoting the old number still resolve to this child.
    expect(docs[path]).toMatchObject({
      status,
      isPrimary: false,
      canonicalProfileId: 'canonical-1',
      updatedBy: 'admin:tt',
    });
  });

  it('refuses to demote a code owned by a different profile', () => {
    const { run, docs, log } = demote('alias', record({ canonicalProfileId: 'someone-else' }));

    expect(run).toThrow('STUDENT_CODE_ALREADY_CLAIMED');
    expect(docs[path]).toMatchObject({ isPrimary: true, status: 'active' });
    expect(log.some((entry) => entry.startsWith('write:'))).toBe(false);
  });

  it('refuses to reopen a retired code as an alias', () => {
    // Retirement is permanent. Downgrading it back to alias would let the code
    // be presented as current again after receipts already referenced it.
    const { run, docs } = demote('alias', record({ status: 'retired', isPrimary: false }));

    expect(run).toThrow('STUDENT_CODE_RETIRED');
    expect(docs[path]).toMatchObject({ status: 'retired' });
  });
});
