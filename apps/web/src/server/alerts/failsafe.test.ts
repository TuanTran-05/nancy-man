import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../security/crypto.js';
import { hashZaloChatId } from '../security/zaloLink.js';
import { createOpsStore } from '../storage/store.js';
import { runFailsafe } from './failsafe.js';

const recipientKey = Buffer.alloc(32, 8);
const chatHashSecret = 'failsafe-chat-hash-secret-value-123456';

const config = (databasePath: string, recipientIds: string[] = []) => ({
  dbPath: databasePath,
  zaloBotToken: 'secret',
  recipientIds,
  zaloChatHashSecret: chatHashSecret,
  zaloRecipientKey: recipientKey,
  zaloTimeoutMs: 5000
});

function seedLinkedRecipients(
  databasePath: string,
  recipients: Array<{ id: string; ciphertext: string; linkedAt: string }>
): void {
  const store = createOpsStore(databasePath, undefined, recipientKey);
  try {
    for (const recipient of recipients) {
      const accountId = `account-${recipient.id}`;
      const codeHash = `code-${recipient.id}`;
      store.createAccount({
        id: accountId,
        username: accountId,
        passwordHash: 'fixture-hash',
        totpSecretEnc: 'fixture-secret',
        createdAt: recipient.linkedAt
      });
      store.createZaloLinkCode({
        codeHash,
        accountId,
        expiresAt: '2026-08-23T01:00:00.000Z',
        createdAt: '2026-08-23T00:00:00.000Z'
      });
      expect(
        store.consumeZaloLink({
          codeHash,
          chatIdHash: hashZaloChatId(recipient.id, chatHashSecret),
          chatIdCiphertext: recipient.ciphertext,
          eventId: `event-${recipient.id}`,
          now: recipient.linkedAt
        })
      ).toMatchObject({ outcome: 'linked' });
    }
  } finally {
    store.getDatabaseForBackup().close();
  }
}

describe('collector failsafe', () => {
  it('sends only the fixed stopped message to configured recipients', async () => {
    const messages: string[] = [];
    await runFailsafe(config(':memory:', ['ops-a', 'ops-b']), async (_url, init) => {
      messages.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: '1' } }), {
        status: 200
      });
    });
    expect(messages).toEqual([
      'CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn',
      'CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn'
    ]);
  });

  it('delivers once when configured and linked sources contain the same recipient', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-failsafe-dedupe-'));
    const databasePath = join(directory, 'ops.sqlite');
    const recipientId = 'same-recipient';
    seedLinkedRecipients(databasePath, [
      {
        id: recipientId,
        ciphertext: encryptSecret(recipientId, recipientKey),
        linkedAt: '2026-08-23T00:01:00.000Z'
      }
    ]);
    const deliveredTo: string[] = [];
    try {
      await runFailsafe(config(databasePath, [recipientId]), async (_url, init) => {
        deliveredTo.push(JSON.parse(String(init?.body)).chat_id);
        return new Response(JSON.stringify({ ok: true, result: { message_id: '1' } }), {
          status: 200
        });
      });

      expect(deliveredTo).toEqual([recipientId]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('skips an undecryptable linked recipient and continues with the next valid recipient', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-failsafe-corrupt-'));
    const databasePath = join(directory, 'ops.sqlite');
    seedLinkedRecipients(databasePath, [
      {
        id: 'corrupt-first',
        ciphertext: 'not-an-encrypted-recipient',
        linkedAt: '2026-08-23T00:01:00.000Z'
      },
      {
        id: 'valid-second',
        ciphertext: encryptSecret('valid-second', recipientKey),
        linkedAt: '2026-08-23T00:02:00.000Z'
      }
    ]);
    const deliveredTo: string[] = [];
    try {
      await runFailsafe(config(databasePath), async (_url, init) => {
        deliveredTo.push(JSON.parse(String(init?.body)).chat_id);
        return new Response(JSON.stringify({ ok: true, result: { message_id: '1' } }), {
          status: 200
        });
      });

      expect(deliveredTo).toEqual(['valid-second']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('continues with a later recipient when the first provider send rejects', async () => {
    const attemptedRecipients: string[] = [];

    await runFailsafe(config(':memory:', ['reject-first', 'valid-second']), async (_url, init) => {
      attemptedRecipients.push(JSON.parse(String(init?.body)).chat_id);
      if (attemptedRecipients.length === 1) throw new Error('synthetic provider rejection');
      return new Response(JSON.stringify({ ok: true, result: { message_id: '2' } }), {
        status: 200
      });
    });

    expect(attemptedRecipients).toEqual(['reject-first', 'valid-second']);
  });

  it('sends to configured recipients when a SQLite write lock prevents store startup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-failsafe-locked-db-'));
    const databasePath = join(directory, 'ops.sqlite');
    const initialized = createOpsStore(databasePath, undefined, recipientKey);
    initialized.getDatabaseForBackup().close();

    const blocker = new Database(databasePath);
    blocker.pragma('journal_mode = WAL');
    blocker.exec('BEGIN IMMEDIATE');
    blocker
      .prepare('INSERT INTO login_attempts (username, attempted_at, success) VALUES (?, ?, ?)')
      .run('lock-fixture', '2026-08-23T00:00:00.000Z', 0);
    const deliveredTo: string[] = [];
    try {
      let lockError: unknown;
      try {
        createOpsStore(databasePath, undefined, recipientKey, { busyTimeoutMs: 25 });
      } catch (error) {
        lockError = error;
      }
      expect(lockError).toMatchObject({
        code: expect.stringMatching(/^SQLITE_(BUSY|LOCKED)/u)
      });

      await runFailsafe(config(databasePath, ['configured-fallback']), async (_url, init) => {
        deliveredTo.push(JSON.parse(String(init?.body)).chat_id);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 'locked-db-ok' } }), {
          status: 200
        });
      });

      expect(deliveredTo).toEqual(['configured-fallback']);
    } finally {
      blocker.exec('ROLLBACK');
      blocker.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails when no collector-failure notification was delivered', async () => {
    await expect(
      runFailsafe(
        config(':memory:', ['configured-only']),
        async () =>
          new Response(JSON.stringify({ ok: false, description: 'unavailable' }), { status: 500 })
      )
    ).rejects.toThrow('OPS_FAILSAFE_NOTIFICATION_UNDELIVERED');
  });
});
