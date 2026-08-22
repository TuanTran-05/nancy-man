import { describe, it, expect, beforeEach } from 'vitest';
import { runZaloBotDailyDigest } from './digestService';
import { DocumentStore, FieldValue } from '@/server/db/documentStore.js';
import { ZaloBotConfig } from './config';
import { makeZaloBotDailyMessageId } from '../../../shared/zaloBot';

class MockDoc {
  constructor(
    public id: string,
    public db: MockDocumentStore,
    public path: string
  ) {}
  async get() {
    const data = this.db.data[this.path];
    return {
      exists: !!data,
      id: this.id,
      data: () => data,
      ref: this,
    };
  }
  async set(data: any, options?: any) {
    if (options?.merge) {
      this.db.data[this.path] = { ...this.db.data[this.path], ...data };
    } else {
      this.db.data[this.path] = { ...data };
    }
  }
  async update(data: any) {
    this.db.data[this.path] = { ...this.db.data[this.path], ...data };
  }
}

class MockCollection {
  constructor(
    public name: string,
    public db: MockDocumentStore
  ) {}
  doc(id?: string) {
    const actualId = id || `auto-id-${Math.random()}`;
    return new MockDoc(actualId, this.db, `${this.name}/${actualId}`);
  }
  where(field: string, op: string, value: any) {
    const coll = this;
    const filterFn = (d: any) => {
      const val = d[field];
      if (op === '==') return val === value;
      if (op === 'in') return value.includes(val);
      return true;
    };
    return new MockQuery(this, filterFn);
  }
  limit() {
    return this;
  }
  async get() {
    const docs = Object.keys(this.db.data)
      .filter((k) => k.startsWith(`${this.name}/`))
      .map((k) => ({
        id: k.split('/')[1],
        data: () => this.db.data[k],
      }));
    return { docs, size: docs.length, forEach: (cb: any) => docs.forEach(cb) };
  }
}

class MockQuery {
  constructor(
    public coll: MockCollection,
    public filterFn: (d: any) => boolean
  ) {}
  where(field: string, op: string, value: any) {
    const oldFilter = this.filterFn;
    const newFilterFn = (d: any) => {
      if (!oldFilter(d)) return false;
      const val = d[field];
      if (op === '==') return val === value;
      if (op === 'in') return value.includes(val);
      return true;
    };
    return new MockQuery(this.coll, newFilterFn);
  }
  limit() {
    return this;
  }
  async get() {
    const docs = Object.keys(this.coll.db.data)
      .filter((k) => k.startsWith(`${this.coll.name}/`))
      .filter((k) => this.filterFn(this.coll.db.data[k]))
      .map((k) => ({
        id: k.split('/')[1],
        data: () => this.coll.db.data[k],
      }));
    return { docs, size: docs.length, forEach: (cb: any) => docs.forEach(cb) };
  }
}

class MockDocumentStore {
  data: Record<string, any> = {};
  collection(name: string) {
    return new MockCollection(name, this);
  }
  async runTransaction(cb: (tx: any) => Promise<any>) {
    const tx = {
      get: async (ref: MockDoc) => ref.get(),
      set: (ref: MockDoc, data: any) => {
        this.data[ref.path] = data;
      },
      update: (ref: MockDoc, data: any) => {
        this.data[ref.path] = { ...this.data[ref.path], ...data };
      },
    };
    return cb(tx);
  }
  async getAll(...refs: MockDoc[]) {
    return Promise.all(refs.map((r) => r.get()));
  }
}

describe('digestService', () => {
  let dbMock: MockDocumentStore;
  let db: DocumentStore;

  beforeEach(() => {
    dbMock = new MockDocumentStore();
    db = dbMock as unknown as DocumentStore;
  });

  const getBaseConfig = (): ZaloBotConfig => ({
    enabled: true,
    dailyDigestEnabled: true,
    dryRun: false,
    chatEnabled: false,
    adminDataEnabled: false,
    adminIntentsEnabled: [],
    adminSnapshotRefreshEnabled: false,
    adminPilotUids: [],
    adminReadAuditRetentionDays: 90,
    token: 'test-token',
    webhookSecret: 'secret',
    linkCodePepper: 'test-pepper',
    chatHashSecret: 'test-chat-secret',
    appUrl: 'https://vps.thienuy.edu.vn',
    requestTimeoutMs: 5000,
  });

  async function setupActiveAdmin(staffId: string) {
    await db.collection('users').doc(staffId).set({
      role: 'admin',
    });
    await db.collection('zalo_bot_links').doc(`link_${staffId}`).set({
      staffId,
      role: 'admin',
      chatIdHash: 'hash',
      status: 'active',
    });
  }

  it('Creates deterministic ID daily_digest_<date>_<staffId> and creates ledger + outbox job', async () => {
    await setupActiveAdmin('admin1');

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });

    expect(result.recipients).toBe(1);
    expect(result.enqueued).toBe(1);

    const msgId = makeZaloBotDailyMessageId('2026-08-10', 'admin1');
    const msgSnap = await db.collection('zalo_bot_messages').doc(msgId).get();
    expect(msgSnap.exists).toBe(true);
    expect(msgSnap.data()?.status).toBe('pending');
    expect(msgSnap.data()?.id).toBe(msgId);

    const jobSnap = await db.collection('outbox_jobs').doc(`zalo-bot:${msgId}`).get();
    expect(jobSnap.exists).toBe(true);
    expect(jobSnap.data()?.type).toBe('send_zalo_bot_message');
    expect(jobSnap.data()?.maxAttempts).toBe(3);
  });

  it('Re-running same date does not overwrite contentSnapshot or duplicate job', async () => {
    await setupActiveAdmin('admin1');
    const msgId = makeZaloBotDailyMessageId('2026-08-10', 'admin1');

    await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });

    const msgSnap1 = await db.collection('zalo_bot_messages').doc(msgId).get();
    const snap1 = msgSnap1.data()?.contentSnapshot;

    const result2 = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });

    expect(result2.existing).toBe(1);
    const msgSnap2 = await db.collection('zalo_bot_messages').doc(msgId).get();
    expect(msgSnap2.data()?.contentSnapshot).toBe(snap1); // Remains same

    const jobs = await db
      .collection('outbox_jobs')
      .where('idempotencyKey', '==', `zalo-bot:${msgId}`)
      .get();
    expect(jobs.size).toBe(1); // No duplicate
  });

  it('Teacher/office with no items -> skipped (no message created)', async () => {
    await db.collection('users').doc('teacher1').set({ role: 'teacher' });
    await db.collection('zalo_bot_links').doc('link_teacher1').set({
      staffId: 'teacher1',
      role: 'teacher',
      chatIdHash: 'hash',
      status: 'active',
    });

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });

    expect(result.recipients).toBe(0);
    const msgs = await db.collection('zalo_bot_messages').get();
    expect(msgs.size).toBe(0);
  });

  it('Every active admin receives message even when counts are zero', async () => {
    await setupActiveAdmin('admin1');
    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });
    expect(result.recipients).toBe(1);
    const msgs = await db.collection('zalo_bot_messages').get();
    expect(msgs.size).toBe(1);
  });

  it('Disabled and needs_relink links -> no job', async () => {
    await db.collection('users').doc('admin1').set({ role: 'admin' });
    await db.collection('zalo_bot_links').doc('link_admin1').set({
      staffId: 'admin1',
      role: 'admin',
      chatIdHash: 'hash',
      status: 'disabled',
    });

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });
    expect(result.recipients).toBe(0);
  });

  it('Link with missing/blocked/ineligible user -> no job', async () => {
    await db.collection('users').doc('admin1').set({ role: 'admin', blockedTeacher: true });
    await db.collection('zalo_bot_links').doc('link_admin1').set({
      staffId: 'admin1',
      role: 'admin',
      chatIdHash: 'hash',
      status: 'active',
    });

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config: getBaseConfig(),
    });
    expect(result.recipients).toBe(0);
  });

  it('Dry run -> creates skipped ledger with errorCode: dry_run, NO outbox job', async () => {
    await setupActiveAdmin('admin1');
    const config = getBaseConfig();
    config.dryRun = true;

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config,
    });

    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);

    const msgId = makeZaloBotDailyMessageId('2026-08-10', 'admin1');
    const snap = await db.collection('zalo_bot_messages').doc(msgId).get();
    expect(snap.data()?.status).toBe('skipped');
    expect(snap.data()?.errorCode).toBe('dry_run');

    const jobs = await db.collection('outbox_jobs').get();
    expect(jobs.size).toBe(0);
  });

  it('Re-running dry-run date after flag change does NOT enqueue terminal skipped ledger', async () => {
    await setupActiveAdmin('admin1');
    const config = getBaseConfig();
    config.dryRun = true;

    await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config,
    });

    config.dryRun = false;
    const result2 = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config,
    });

    expect(result2.skipped).toBe(1);
    expect(result2.enqueued).toBe(0);
  });

  it('Digest disabled -> returns skipped run result, writes no recipient ledger', async () => {
    await setupActiveAdmin('admin1');
    const config = getBaseConfig();
    config.dailyDigestEnabled = false;

    const result = await runZaloBotDailyDigest(db, {
      digestDate: '2026-08-10',
      tomorrowDate: '2026-08-11',
      config,
    });

    expect(result.recipients).toBe(0);
    const msgs = await db.collection('zalo_bot_messages').get();
    expect(msgs.size).toBe(0);
  });
});
