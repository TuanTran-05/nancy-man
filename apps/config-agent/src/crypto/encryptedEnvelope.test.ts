import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  decryptEnvelope,
  encryptEnvelope,
  EnvelopeError,
  createEnvelopeKey,
  assertDistinctEnvelopeKeys,
  loadEnvelopeKey,
  type EnvelopeHeader
} from './encryptedEnvelope.js';

const stagingKey = createEnvelopeKey({
  purpose: 'staging',
  keyId: 'staging-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x11)
});
const snapshotKey = createEnvelopeKey({
  purpose: 'snapshot',
  keyId: 'snapshot-v1',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 0x22)
});

function header(overrides: Partial<EnvelopeHeader> = {}): EnvelopeHeader {
  return {
    envelopeType: 'draft',
    purpose: 'staging',
    changeId: 'change-123',
    appId: 'api',
    catalogVersion: '2026-08-31',
    manifestVersion: '2026-08-31',
    keyId: stagingKey.keyId,
    keyVersion: stagingKey.keyVersion,
    expiresAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function deterministicNonceFactory() {
  let counter = 0;
  return (size: number): Buffer => Buffer.alloc(size, ++counter);
}

describe('encrypted envelopes', () => {
  test('round-trips payload while keeping the plaintext sentinel out of the artifact', () => {
    const plaintext = Buffer.from('super-secret-sentinel=do-not-persist-in-cleartext', 'utf8');
    const artifact = encryptEnvelope({
      key: stagingKey,
      header: header(),
      plaintext,
      randomBytes: deterministicNonceFactory()
    });

    expect(artifact.toString('utf8')).not.toContain('super-secret-sentinel');
    expect(
      decryptEnvelope({
        artifact,
        keys: [stagingKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toEqual(plaintext);
  });

  test('uses a fresh 96-bit nonce for every encryption', () => {
    const nonces = new Set<string>();
    let counter = 0;
    const randomBytes = (size: number): Buffer => {
      const result = Buffer.alloc(size);
      result.writeUInt32BE(counter++, 8);
      return result;
    };

    for (let index = 0; index < 8; index += 1) {
      const artifact = encryptEnvelope({
        key: stagingKey,
        header: header({ changeId: `change-${index}` }),
        plaintext: Buffer.from('payload'),
        randomBytes
      });
      nonces.add(JSON.parse(artifact.toString('utf8')).nonce);
    }

    expect(nonces).toHaveLength(8);
  });

  test.each([
    ['envelopeType', { envelopeType: 'staged' }],
    ['purpose', { purpose: 'snapshot' }],
    ['changeId', { changeId: 'other-change' }],
    ['appId', { appId: 'web' }],
    ['catalogVersion', { catalogVersion: 'other-catalog' }],
    ['manifestVersion', { manifestVersion: 'other-manifest' }],
    ['keyId', { keyId: 'staging-v2' }],
    ['keyVersion', { keyVersion: 'v2' }],
    ['expiry', { expiresAt: '2026-09-02T00:00:00.000Z' }]
  ])('rejects authenticated-header tampering for %s', (_field, change) => {
    const artifact = encryptEnvelope({
      key: stagingKey,
      header: header(),
      plaintext: Buffer.from('payload'),
      randomBytes: deterministicNonceFactory()
    });
    const parsed = JSON.parse(artifact.toString('utf8')) as {
      header: EnvelopeHeader;
    };
    parsed.header = { ...parsed.header, ...change };

    expect(() =>
      decryptEnvelope({
        artifact: Buffer.from(JSON.stringify(parsed)),
        keys: [stagingKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(EnvelopeError);
  });

  test.each(['nonce', 'ciphertext', 'authTag'])('rejects tampered %s bytes', (field) => {
    const artifact = encryptEnvelope({
      key: stagingKey,
      header: header(),
      plaintext: Buffer.from('payload'),
      randomBytes: deterministicNonceFactory()
    });
    const parsed = JSON.parse(artifact.toString('utf8')) as Record<string, string>;
    const bytes = Buffer.from(parsed[field] ?? '', 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    parsed[field] = bytes.toString('base64');

    expect(() =>
      decryptEnvelope({
        artifact: Buffer.from(JSON.stringify(parsed)),
        keys: [stagingKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_AUTH_FAILED' }));
  });

  test('rejects wrong purpose, wrong version, expired, truncated, and malformed artifacts', () => {
    const artifact = encryptEnvelope({
      key: stagingKey,
      header: header(),
      plaintext: Buffer.from('payload'),
      randomBytes: deterministicNonceFactory()
    });

    expect(() =>
      decryptEnvelope({
        artifact,
        keys: [snapshotKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_KEY_REJECTED' }));
    expect(() =>
      decryptEnvelope({
        artifact,
        keys: [createEnvelopeKey({ ...stagingKey, keyVersion: 'v2' })],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_KEY_REJECTED' }));
    expect(() =>
      decryptEnvelope({
        artifact,
        keys: [stagingKey],
        now: new Date('2026-09-01T00:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_EXPIRED' }));
    expect(() =>
      decryptEnvelope({
        artifact: artifact.subarray(0, artifact.length - 2),
        keys: [stagingKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_MALFORMED' }));
    expect(() =>
      decryptEnvelope({
        artifact: Buffer.from('{broken'),
        keys: [stagingKey],
        now: new Date('2026-08-31T12:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_MALFORMED' }));
  });

  test('requires separate purpose keys and rejects duplicate key material', () => {
    expect(() =>
      createEnvelopeKey({
        purpose: 'staging',
        keyId: 'bad',
        keyVersion: 'v1',
        bytes: Buffer.alloc(31)
      })
    ).toThrowError(expect.objectContaining({ code: 'ENVELOPE_KEY_INVALID' }));

    const duplicateSnapshotKey = createEnvelopeKey({
      purpose: 'snapshot',
      keyId: 'snapshot-v1',
      keyVersion: 'v1',
      bytes: Buffer.alloc(32, 0x11)
    });
    expect(() => assertDistinctEnvelopeKeys([stagingKey, duplicateSnapshotKey])).toThrowError(
      expect.objectContaining({ code: 'ENVELOPE_KEY_REUSED' })
    );
  });

  test('loads exactly 32 credential bytes without following a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edutrack-config-agent-keys-'));
    const path = join(root, 'staging-key');
    const link = join(root, 'link-key');
    await writeFile(path, Buffer.alloc(32, 0x71), { mode: 0o400 });
    await symlink(path, link);

    await expect(
      loadEnvelopeKey({ path, purpose: 'staging', keyId: 'staging-v1', keyVersion: 'v1' })
    ).resolves.toEqual(expect.objectContaining({ purpose: 'staging', keyId: 'staging-v1' }));
    await chmod(path, 0o600);
    await expect(
      loadEnvelopeKey({ path, purpose: 'staging', keyId: 'staging-v1', keyVersion: 'v1' })
    ).rejects.toThrowError(expect.objectContaining({ code: 'ENVELOPE_CREDENTIAL_INVALID' }));
    await expect(
      loadEnvelopeKey({
        path: link,
        purpose: 'staging',
        keyId: 'staging-v1',
        keyVersion: 'v1'
      })
    ).rejects.toThrowError(expect.objectContaining({ code: 'ENVELOPE_CREDENTIAL_INVALID' }));
  });
});
