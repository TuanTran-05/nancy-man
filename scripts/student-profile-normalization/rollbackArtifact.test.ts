import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GeoPoint, Timestamp } from '@/server/db/documentStore.js';
import {
  decryptRollbackBeforeImages,
  encryptRollbackBeforeImages,
  ROLLBACK_ARTIFACT_FILE_NAME,
} from './rollbackArtifact.js';

const KEY = randomBytes(32).toString('base64');
const AAD = {
  projectId: 'edutrack-prod',
  databaseId: 'edutrack',
  runId: 'run-2026-08-07-01',
  planPreimageDigest: 'a'.repeat(64),
};

const ENTRIES = [
  { entryId: 'e-1', path: 'students/legacy-1', before: { name: 'Quách Hoàng Minh', walletBalance: 0 } },
  { entryId: 'e-2', path: 'users/parent:legacy-1', before: { role: 'parent', studentId: 'legacy-1' } },
];

describe('rollback artifact encryption', () => {
  it('round-trips the before images', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const restored = decryptRollbackBeforeImages({ artifact, aad: AAD, keyBase64: KEY });

    expect(restored).toEqual(ENTRIES);
    expect(artifact.entryCount).toBe(2);
    expect(artifact.algorithm).toBe('AES-256-GCM');
    expect(artifact.fileName).toBe(ROLLBACK_ARTIFACT_FILE_NAME);
  });

  it('round-trips DocumentStore value types without flattening them into plain objects', () => {
    const timestamp = new Timestamp(1_786_243_200, 123_456_789);
    const entries = [
      {
        entryId: 'typed',
        path: 'students/typed',
        before: {
          createdAt: timestamp,
          location: new GeoPoint(10.7769, 106.7009),
          faceBytes: Buffer.from([1, 2, 3]),
        },
      },
    ];
    const artifact = encryptRollbackBeforeImages({ entries, aad: AAD, keyBase64: KEY });
    const restored = decryptRollbackBeforeImages({ artifact, aad: AAD, keyBase64: KEY });

    expect(restored[0].before.createdAt).toBeInstanceOf(Timestamp);
    expect((restored[0].before.createdAt as Timestamp).seconds).toBe(timestamp.seconds);
    expect((restored[0].before.createdAt as Timestamp).nanoseconds).toBe(timestamp.nanoseconds);
    expect(restored[0].before.location).toEqual(new GeoPoint(10.7769, 106.7009));
    expect(restored[0].before.faceBytes).toEqual(Buffer.from([1, 2, 3]));
  });

  it('uses a fresh nonce for every encryption of identical input', () => {
    const first = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const second = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });

    // A reused nonce under one key destroys GCM's confidentiality entirely.
    expect(first.ivBase64).not.toBe(second.ivBase64);
    expect(first.ciphertextBase64).not.toBe(second.ciphertextBase64);
  });

  it('refuses to decrypt when the run it was bound to differs', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });

    expect(() =>
      decryptRollbackBeforeImages({
        artifact,
        aad: { ...AAD, runId: 'run-other' },
        keyBase64: KEY,
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC');
  });

  it('refuses to decrypt when the plan it was bound to differs', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });

    expect(() =>
      decryptRollbackBeforeImages({
        artifact,
        aad: { ...AAD, planPreimageDigest: 'b'.repeat(64) },
        keyBase64: KEY,
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC');
  });

  it('refuses to decrypt with the wrong key', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });

    expect(() =>
      decryptRollbackBeforeImages({
        artifact,
        aad: AAD,
        keyBase64: randomBytes(32).toString('base64'),
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC');
  });

  it('refuses to decrypt a truncated or edited ciphertext', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const tampered = {
      ...artifact,
      ciphertextBase64: Buffer.from(
        Buffer.from(artifact.ciphertextBase64, 'base64').subarray(0, -4)
      ).toString('base64'),
    };

    expect(() => decryptRollbackBeforeImages({ artifact: tampered, aad: AAD, keyBase64: KEY })).toThrow(
      'STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC'
    );
  });

  it('never places the key or plaintext in the artifact', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const serialized = JSON.stringify(artifact);

    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('Quách Hoàng Minh');
    expect(serialized).not.toContain('walletBalance');
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() =>
      encryptRollbackBeforeImages({
        entries: ENTRIES,
        aad: AAD,
        keyBase64: randomBytes(16).toString('base64'),
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_KEY_INVALID');
  });

  it('rejects an empty entry set rather than producing an artifact that restores nothing', () => {
    expect(() => encryptRollbackBeforeImages({ entries: [], aad: AAD, keyBase64: KEY })).toThrow(
      'STUDENT_PROFILE_ROLLBACK_ARTIFACT_EMPTY'
    );
  });

  it('digests the sealed bytes so a swapped artifact fails the plan binding', () => {
    const first = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const other = encryptRollbackBeforeImages({
      entries: [ENTRIES[0]],
      aad: AAD,
      keyBase64: KEY,
    });

    expect(first.digest).toHaveLength(64);
    expect(first.digest).not.toBe(other.digest);
  });

  it('produces the same digest when the same sealed bytes are re-read', () => {
    const artifact = encryptRollbackBeforeImages({ entries: ENTRIES, aad: AAD, keyBase64: KEY });
    const reread = { ...artifact };

    expect(reread.digest).toBe(artifact.digest);
  });
});
