import { describe, expect, it } from 'vitest';

import { PostgresNonceStore } from './postgresNonceStore.js';

type StoredNonce = { hash: string; expiresAt: Date };

function createDatabase() {
  const nonces: StoredNonce[] = [];
  const valuesWritten: unknown[] = [];

  return {
    valuesWritten,
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      if (sql.includes('DELETE FROM ingest_nonces')) {
        const now = parameters[0] as Date;
        for (let index = nonces.length - 1; index >= 0; index -= 1) {
          if (nonces[index]!.expiresAt <= now) nonces.splice(index, 1);
        }
        return { rows: [] as T[] };
      }
      if (sql.includes('INSERT INTO ingest_nonces')) {
        const hash = String(parameters[0]);
        const expiresAt = parameters[1] as Date;
        valuesWritten.push(hash);
        if (nonces.some((nonce) => nonce.hash === hash)) return { rows: [] as T[] };
        nonces.push({ hash, expiresAt });
        return { rows: [{ nonceHash: hash }] as T[] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

describe('PostgresNonceStore', () => {
  it('atomically rejects a replay and permits the nonce again only after its expiry', async () => {
    const database = createDatabase();
    const store = new PostgresNonceStore(database);
    const firstNow = new Date('2026-08-22T10:00:00.000Z');
    const firstExpiry = new Date('2026-08-22T10:01:00.000Z');

    await expect(store.consume('nonce-0123456789abcdef', firstExpiry, firstNow)).resolves.toBe(
      true
    );
    await expect(store.consume('nonce-0123456789abcdef', firstExpiry, firstNow)).resolves.toBe(
      false
    );
    await expect(
      store.consume(
        'nonce-0123456789abcdef',
        new Date('2026-08-22T10:03:00.000Z'),
        new Date('2026-08-22T10:02:00.000Z')
      )
    ).resolves.toBe(true);
  });

  it('stores only the nonce digest in the Ops database', async () => {
    const database = createDatabase();
    const store = new PostgresNonceStore(database);

    await store.consume(
      'nonce-0123456789abcdef',
      new Date('2026-08-22T10:01:00.000Z'),
      new Date('2026-08-22T10:00:00.000Z')
    );

    expect(database.valuesWritten).toEqual([
      'e672218e57ca6e2f343f0d9dc8c01cba42788acbf00f7b4b61e13b09f885369a'
    ]);
  });
});
