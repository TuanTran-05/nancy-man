import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());

vi.mock('./client.js', () => ({
  getPostgresPool: vi.fn(() => ({ query, connect })),
}));

import {
  FieldValue,
  GeoPoint,
  PostgresDocumentStore,
  Timestamp,
} from './documentStore.js';

describe('PostgresDocumentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    connect.mockResolvedValue({ query, release });
  });

  it('flushes buffered transaction writes before commit', async () => {
    const store = new PostgresDocumentStore();

    await store.runTransaction(async (transaction) => {
      transaction.set(store.collection('users').doc('u1'), {
        displayName: 'Native user',
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'begin isolation',
      'insert into',
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('encodes timestamps, geopoints and transforms as JSONB-compatible values', async () => {
    const store = new PostgresDocumentStore();
    await store.collection('profiles').doc('p1').set({
      seenAt: Timestamp.fromMillis(1_700_000_000_000),
      location: new GeoPoint(10.77, 106.7),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const payload = JSON.parse(query.mock.calls[0][1][2]);
    expect(payload.seenAt.__edutrack_timestamp_ms__).toBe(1_700_000_000_000);
    expect(payload.location).toMatchObject({
      __edutrack_geopoint__: true,
      latitude: 10.77,
      longitude: 106.7,
    });
    expect(payload.updatedAt.__edutrack_timestamp_ms__).toEqual(expect.any(Number));
  });
});
