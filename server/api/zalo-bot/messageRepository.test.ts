import { describe, it, expect, beforeEach } from 'vitest';
import {
  createZaloBotMessageIfAbsent,
  claimZaloBotMessageForDelivery,
  beginZaloBotProviderAttempt,
} from './messageRepository';
import { ZaloBotMessage } from '../../../shared/zaloBot';
import { DocumentStore } from '@/server/db/documentStore.js';

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
}

describe('messageRepository', () => {
  let dbMock: MockDocumentStore;
  let db: DocumentStore;

  beforeEach(() => {
    dbMock = new MockDocumentStore();
    db = dbMock as unknown as DocumentStore;
  });

  const getBaseMessage = (id: string = 'msg1'): ZaloBotMessage => ({
    id,
    staffId: 'staff1',
    role: 'teacher',
    chatIdHash: 'hash1',
    digestDate: '2026-08-15',
    messageType: 'daily_digest',
    contentSnapshot: 'content',
    status: 'pending',
    attempts: 0,
    createdAt: '2026-08-15T12:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z',
  });

  it('createZaloBotMessageIfAbsent returns created on new, existing on duplicate', async () => {
    const msg = getBaseMessage();
    const res1 = await createZaloBotMessageIfAbsent(db, msg);
    expect(res1).toBe('created');

    const res2 = await createZaloBotMessageIfAbsent(db, msg);
    expect(res2).toBe('existing');
  });

  it('claimZaloBotMessageForDelivery: fresh claim -> claimed', async () => {
    const msg = getBaseMessage();
    await createZaloBotMessageIfAbsent(db, msg);

    const res = await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });

    expect(res).toBe('claimed');
    const snap = await db.collection('zalo_bot_messages').doc(msg.id).get();
    expect(snap.data()?.status).toBe('processing');
    expect(snap.data()?.lockedBy).toBe('worker1');
  });

  it('Second worker on fresh claim -> busy', async () => {
    const msg = getBaseMessage();
    await createZaloBotMessageIfAbsent(db, msg);

    await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });

    const res2 = await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker2',
      now: '2026-08-15T12:02:00Z',
    });

    expect(res2).toBe('busy');
  });

  it('5-minute-stale processing claim -> claimed (reclaimed)', async () => {
    const msg = getBaseMessage();
    await createZaloBotMessageIfAbsent(db, msg);

    await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z', // Claimed at 12:01
    });

    const res2 = await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker2',
      now: '2026-08-15T12:06:01Z', // Reclaimed at 12:06:01 (> 5m later)
    });

    expect(res2).toBe('claimed');
    const snap = await db.collection('zalo_bot_messages').doc(msg.id).get();
    expect(snap.data()?.lockedBy).toBe('worker2');
  });

  it('Terminal status (sent/skipped) -> terminal', async () => {
    const msg = getBaseMessage();
    msg.status = 'sent';
    await db.collection('zalo_bot_messages').doc(msg.id).set(msg);

    const res = await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });
    expect(res).toBe('terminal');

    const msg2 = getBaseMessage('msg2');
    msg2.status = 'skipped';
    await db.collection('zalo_bot_messages').doc(msg2.id).set(msg2);

    const res2 = await claimZaloBotMessageForDelivery(db, {
      messageId: msg2.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });
    expect(res2).toBe('terminal');
  });

  it('Missing doc -> missing', async () => {
    const res = await claimZaloBotMessageForDelivery(db, {
      messageId: 'nonexistent',
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });
    expect(res).toBe('missing');
  });

  it('beginZaloBotProviderAttempt increments attempts, requires lockedBy match', async () => {
    const msg = getBaseMessage();
    await createZaloBotMessageIfAbsent(db, msg);

    await claimZaloBotMessageForDelivery(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:01:00Z',
    });

    await expect(
      beginZaloBotProviderAttempt(db, {
        messageId: msg.id,
        lockerId: 'worker2',
        now: '2026-08-15T12:02:00Z',
      })
    ).rejects.toThrow();

    const res = await beginZaloBotProviderAttempt(db, {
      messageId: msg.id,
      lockerId: 'worker1',
      now: '2026-08-15T12:02:00Z',
    });

    expect(res.attempt).toBe(1);

    const snap = await db.collection('zalo_bot_messages').doc(msg.id).get();
    expect(snap.data()?.attempts).toBe(1);
    expect(snap.data()?.lastAttemptAt).toBe('2026-08-15T12:02:00Z');
  });
});
