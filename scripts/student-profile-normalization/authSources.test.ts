import { describe, expect, it } from 'vitest';
import { Timestamp } from '@/server/db/documentStore.js';
import { summarizeLinkedUser, summarizeStudentCredential } from './authSources.js';

const SECRETS = {
  loginPasswordSalt: 'salt-abcdef0123456789',
  loginPasswordHash: 'hash-fedcba9876543210',
  passwordVersion: 2,
  parentPasswordSalt: 'parent-salt-0011',
  parentPasswordHash: 'parent-hash-2233',
  parentPasswordVersion: 1,
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('summarizeStudentCredential — secrets never escape', () => {
  it('emits no salt, hash, or token substring anywhere in its output', () => {
    const summary = summarizeStudentCredential('legacy-1', {
      ...SECRETS,
      resetToken: 'tok-supersecret',
    });
    const serialized = JSON.stringify(summary);

    for (const secret of [
      SECRETS.loginPasswordSalt,
      SECRETS.loginPasswordHash,
      SECRETS.parentPasswordSalt,
      SECRETS.parentPasswordHash,
      'tok-supersecret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('reports presence and version without the material itself', () => {
    const summary = summarizeStudentCredential('legacy-1', SECRETS);

    expect(summary).toMatchObject({
      profileId: 'legacy-1',
      exists: true,
      hasStudentPassword: true,
      hasParentPassword: true,
      studentPasswordVersion: 2,
      parentPasswordVersion: 1,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('treats a missing document as absent rather than as empty credentials', () => {
    const summary = summarizeStudentCredential('legacy-1', null);

    expect(summary.exists).toBe(false);
    expect(summary.hasStudentPassword).toBe(false);
    expect(summary.materialFingerprint).toBeNull();
  });

  it('gives identical material one fingerprint and differing material another', () => {
    const a = summarizeStudentCredential('a', SECRETS);
    const b = summarizeStudentCredential('b', { ...SECRETS });
    const c = summarizeStudentCredential('c', { ...SECRETS, loginPasswordHash: 'hash-different' });

    // Fingerprints compare material, not which profile holds it.
    expect(a.materialFingerprint).toBe(b.materialFingerprint);
    expect(a.materialFingerprint).not.toBe(c.materialFingerprint);
  });

  it('normalizes a Timestamp updatedAt to the same value as its ISO twin', () => {
    const iso = summarizeStudentCredential('a', SECRETS);
    const stamped = summarizeStudentCredential('a', {
      ...SECRETS,
      updatedAt: Timestamp.fromDate(new Date('2026-07-01T00:00:00.000Z')),
    });

    expect(stamped.updatedAt).toBe(iso.updatedAt);
  });

  it('records a student-only credential as having no parent password', () => {
    const summary = summarizeStudentCredential('a', {
      loginPasswordSalt: 's',
      loginPasswordHash: 'h',
      passwordVersion: 1,
    });

    expect(summary.hasStudentPassword).toBe(true);
    expect(summary.hasParentPassword).toBe(false);
    expect(summary.parentPasswordVersion).toBeNull();
  });
});

describe('summarizeLinkedUser', () => {
  it('reads the role from the document id prefix', () => {
    expect(summarizeLinkedUser('student:legacy-1', { studentId: 'legacy-1' })).toMatchObject({
      role: 'student',
      idProfileId: 'legacy-1',
      fieldProfileId: 'legacy-1',
      idFieldAgree: true,
    });
    expect(summarizeLinkedUser('parent:legacy-1', { studentId: 'legacy-1' }).role).toBe('parent');
  });

  it('flags a user whose id and studentId field name different profiles', () => {
    // Produced by an earlier partial data fix: the field was repointed while
    // the document id still carries the old profile.
    const summary = summarizeLinkedUser('parent:legacy-1', { studentId: 'canonical-1' });

    expect(summary).toMatchObject({
      role: 'parent',
      idProfileId: 'legacy-1',
      fieldProfileId: 'canonical-1',
      idFieldAgree: false,
    });
  });

  it('refuses to guess a role it does not recognize', () => {
    const summary = summarizeLinkedUser('teacher:abc', { studentId: 'legacy-1' });

    expect(summary.role).toBe('unknown');
    expect(summary.idProfileId).toBeNull();
  });

  it('treats a field-only user with no id prefix as unknown, not as a student', () => {
    const summary = summarizeLinkedUser('gAbC123random', { studentId: 'legacy-1' });

    expect(summary.role).toBe('unknown');
    expect(summary.fieldProfileId).toBe('legacy-1');
  });

  it('reports revoked and disabled state without exposing auth internals', () => {
    const summary = summarizeLinkedUser('student:legacy-1', {
      studentId: 'legacy-1',
      isRevoked: true,
      passwordHash: 'should-not-appear',
    });

    expect(summary.isRevoked).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('should-not-appear');
  });
});
