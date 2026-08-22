import { createHash } from 'node:crypto';

import { type NonceStore } from './hmac.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

export class PostgresNonceStore implements NonceStore {
  constructor(private readonly database: QueryDatabase) {}

  async consume(nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    const hash = nonceHash(nonce);
    await this.database.query('DELETE FROM ingest_nonces WHERE expires_at <= $1', [now]);
    const { rows } = await this.database.query<{ nonceHash: string }>(
      `
        INSERT INTO ingest_nonces (nonce_hash, expires_at)
        VALUES ($1, $2)
        ON CONFLICT (nonce_hash) DO NOTHING
        RETURNING nonce_hash AS "nonceHash"
      `,
      [hash, expiresAt]
    );
    return rows.length === 1;
  }
}
