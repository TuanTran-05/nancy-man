import { describe, expect, it } from 'vitest';
import { Timestamp } from '@/server/db/documentStore.js';
import {
  assertArtifactContainsNoCredentialSecrets,
  assertSafeIntegerMoney,
  canonicalJson,
  fingerprintDocumentProjection,
  normalizeInstantForCanonicalJson,
  sha256,
} from './canonicalJson.js';

describe('canonicalJson', () => {
  it('produces stable key ordering regardless of insertion order', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJson({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order because it is meaningful', () => {
    const a = canonicalJson({ items: [3, 1, 2] });
    const b = canonicalJson({ items: [1, 2, 3] });
    expect(a).not.toBe(b);
  });

  it('sha256 is deterministic and changes with input', () => {
    const h1 = sha256('a');
    const h2 = sha256('a');
    const h3 = sha256('b');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('normalizeInstantForCanonicalJson', () => {
  it('normalizes a DocumentStore Timestamp, an equivalent ISO string, and an equivalent epoch millisecond number to the same value', () => {
    const iso = '2026-08-01T02:00:00.000Z';
    const ts = Timestamp.fromDate(new Date(iso));
    const epochMs = new Date(iso).getTime();

    const fromTimestamp = normalizeInstantForCanonicalJson(ts);
    const fromIso = normalizeInstantForCanonicalJson(iso);
    const fromEpoch = normalizeInstantForCanonicalJson(epochMs);

    expect(fromTimestamp).toBe(fromIso);
    expect(fromIso).toBe(fromEpoch);
    expect(fromTimestamp).toBe(iso);
  });

  it('rejects a value that cannot be interpreted as an instant rather than comparing it unequal silently', () => {
    expect(() => normalizeInstantForCanonicalJson('not-a-date')).toThrow(
      'CANONICAL_JSON_UNNORMALIZABLE_INSTANT'
    );
    expect(() => normalizeInstantForCanonicalJson({})).toThrow(
      'CANONICAL_JSON_UNNORMALIZABLE_INSTANT'
    );
  });

  it('passes null and undefined through unchanged', () => {
    expect(normalizeInstantForCanonicalJson(null)).toBeNull();
    expect(normalizeInstantForCanonicalJson(undefined)).toBeUndefined();
  });
});

describe('fingerprintDocumentProjection', () => {
  it('produces the same fingerprint for a document whose only difference is timestamp representation', () => {
    const iso = '2026-08-01T02:00:00.000Z';
    const ts = Timestamp.fromDate(new Date(iso));

    const withTimestamp = fingerprintDocumentProjection({ studentId: 's-1', createdAt: ts });
    const withIsoString = fingerprintDocumentProjection({ studentId: 's-1', createdAt: iso });
    const withEpochMs = fingerprintDocumentProjection({
      studentId: 's-1',
      createdAt: new Date(iso).getTime(),
    });

    expect(withTimestamp).toBe(withIsoString);
    expect(withIsoString).toBe(withEpochMs);
  });

  it('changes when a non-timestamp field changes', () => {
    const a = fingerprintDocumentProjection({ studentId: 's-1' });
    const b = fingerprintDocumentProjection({ studentId: 's-2' });
    expect(a).not.toBe(b);
  });

  it('rejects an unnormalizable nested instant as a blocker rather than silently mismatching', () => {
    expect(() =>
      fingerprintDocumentProjection({ studentId: 's-1', createdAt: 'garbage-date' })
    ).toThrow('CANONICAL_JSON_UNNORMALIZABLE_INSTANT');
  });
});

describe('assertSafeIntegerMoney', () => {
  it('accepts a safe integer', () => {
    expect(() => assertSafeIntegerMoney(1_200_000, 'wallet.balance')).not.toThrow();
    expect(() => assertSafeIntegerMoney(0, 'wallet.balance')).not.toThrow();
  });

  it('rejects NaN, Infinity, fractional, and unsafe-integer money', () => {
    expect(() => assertSafeIntegerMoney(Number.NaN, 'x')).toThrow(
      'STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER:x'
    );
    expect(() => assertSafeIntegerMoney(Number.POSITIVE_INFINITY, 'x')).toThrow(
      'STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER:x'
    );
    expect(() => assertSafeIntegerMoney(1200.5, 'x')).toThrow(
      'STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER:x'
    );
    expect(() => assertSafeIntegerMoney(Number.MAX_SAFE_INTEGER + 1, 'x')).toThrow(
      'STUDENT_MERGE_MONEY_NOT_SAFE_INTEGER:x'
    );
  });
});

describe('assertArtifactContainsNoCredentialSecrets', () => {
  it('passes an artifact containing only metadata', () => {
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({
        credential: { exists: true, updatedAt: '2026-08-01T00:00:00.000Z', version: 2 },
      })
    ).not.toThrow();
  });

  it('allows the non-credential searchTokens index without allowing bearer tokens', () => {
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({
        accountingSummary: { searchTokens: ['ng', 'nguyen', 'hs260'] },
      })
    ).not.toThrow();
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({ accountingSummary: { resetToken: 'x' } })
    ).toThrow('STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:resetToken');
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({ accountingSummary: { searchTokens: 'x' } })
    ).toThrow('STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:searchTokens');
  });

  it('allows a boolean forcePasswordChange policy flag but not credential material', () => {
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({ user: { forcePasswordChange: true } })
    ).not.toThrow();
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({
        user: { forcePasswordChange: 'temporary-pass' },
      })
    ).toThrow('STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:forcePasswordChange');
  });

  it('rejects an artifact carrying a password, hash, salt, or token field by name', () => {
    for (const key of ['passwordHash', 'salt', 'resetToken', 'accessToken', 'password']) {
      expect(() =>
        assertArtifactContainsNoCredentialSecrets({ credential: { [key]: 'x' } })
      ).toThrow(`STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:${key}`);
    }
  });

  it('rejects a secret nested arbitrarily deep', () => {
    expect(() =>
      assertArtifactContainsNoCredentialSecrets({ a: { b: { c: { passwordHash: 'x' } } } })
    ).toThrow('STUDENT_MERGE_ARTIFACT_CONTAINS_SECRET:passwordHash');
  });
});
