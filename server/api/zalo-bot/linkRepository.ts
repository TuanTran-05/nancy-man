import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ZaloBotConfig } from './config.js';
import type { ZaloBotStaffRole, ZaloBotLink } from '../../../shared/zaloBot.js';

export type ZaloBotLinkActor = {
  uid: string;
  role: ZaloBotStaffRole;
  displayName: string;
};

export type PendingZaloBotChat = {
  chatId: string;
  chatIdHash: string;
  displayName: string;
  username?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  blockedUntil?: string;
};

export type LinkRepositoryDeps = {
  now: () => string;
  generateCode: () => string;
  hmac: (secret: string, data: string) => string;
  config: ZaloBotConfig;
};

export async function issueZaloBotLinkCode(
  db: DocumentStore,
  staff: ZaloBotLinkActor,
  deps: LinkRepositoryDeps
): Promise<{ code: string; expiresAt: string }> {
  const code = deps.generateCode();
  const normalizedCode = code.replace(/-/g, '').toUpperCase();
  const codeHash = deps.hmac(deps.config.linkCodePepper, normalizedCode);

  const nowMs = new Date(deps.now()).getTime();
  const expiresAtMs = nowMs + 10 * 60 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();

  await db.collection('zalo_bot_link_codes').doc(codeHash).set({
    staffId: staff.uid,
    role: staff.role,
    displayName: staff.displayName,
    expiresAt,
    issuedAt: deps.now(),
  });

  return { code, expiresAt };
}

export async function recordPendingZaloBotChat(
  db: DocumentStore,
  chat: { chatId: string; displayName: string; username?: string; webhookEventId: string },
  deps: LinkRepositoryDeps
): Promise<PendingZaloBotChat> {
  const chatIdHash = deps.hmac(deps.config.chatHashSecret, chat.chatId);
  const now = deps.now();

  const ref = db.collection('zalo_bot_pending_chats').doc(chatIdHash);

  return db.runTransaction(async (tx) => {
    // 5. Write webhook event marker atomically
    const markerRef = db.collection('_maintenance').doc(`zaloBotWebhook_${chat.webhookEventId}`);
    const markerSnap = await tx.get(markerRef);
    if (markerSnap.exists) {
      // Return existing pending chat
      const existing = await tx.get(ref);
      return existing.data() as PendingZaloBotChat;
    }

    const snap = await tx.get(ref);
    let data: PendingZaloBotChat;

    if (snap.exists) {
      const existing = snap.data() as PendingZaloBotChat;
      data = {
        ...existing,
        displayName: chat.displayName,
        username: chat.username,
        lastSeenAt: now,
      };
      tx.update(ref, data);
    } else {
      data = {
        chatId: chat.chatId,
        chatIdHash,
        displayName: chat.displayName,
        username: chat.username,
        firstSeenAt: now,
        lastSeenAt: now,
        attemptCount: 0,
      };
      tx.set(ref, data);
    }

    tx.set(markerRef, {
      kind: 'zalo_bot_webhook',
      eventName: 'recordPendingZaloBotChat',
      messageId: chat.webhookEventId,
      outcome: 'recorded',
      createdAt: now,
    });

    return data;
  });
}

export async function consumeZaloBotLinkCode(
  db: DocumentStore,
  input: {
    code: string;
    chatId: string;
    displayName: string;
    username?: string;
    webhookEventId: string;
  },
  deps: LinkRepositoryDeps
): Promise<ZaloBotLink> {
  const normalizedCode = input.code.replace(/-/g, '').toUpperCase();
  const codeHash = deps.hmac(deps.config.linkCodePepper, normalizedCode);
  const chatIdHash = deps.hmac(deps.config.chatHashSecret, input.chatId);
  const now = deps.now();

  const result = await db.runTransaction(async (tx) => {
    const markerRef = db.collection('_maintenance').doc(`zaloBotWebhook_${input.webhookEventId}`);
    const markerSnap = await tx.get(markerRef);
    if (markerSnap.exists) {
      return { error: 'WEBHOOK_ALREADY_PROCESSED' };
    }

    // Rate limiting check
    const pendingRef = db.collection('zalo_bot_pending_chats').doc(chatIdHash);
    const pendingSnap = await tx.get(pendingRef);
    if (pendingSnap.exists) {
      const pendingData = pendingSnap.data() as PendingZaloBotChat;
      if (
        pendingData.blockedUntil &&
        new Date(pendingData.blockedUntil).getTime() > new Date(now).getTime()
      ) {
        tx.set(markerRef, {
          kind: 'zalo_bot_webhook',
          eventName: 'consumeZaloBotLinkCode',
          messageId: input.webhookEventId,
          outcome: 'blocked',
          createdAt: now,
        });
        return { error: 'BLOCKED' };
      }
    }

    const codeRef = db.collection('zalo_bot_link_codes').doc(codeHash);
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) {
      await recordFailedAttempt(
        tx,
        db,
        chatIdHash,
        input.chatId,
        input.displayName,
        input.username,
        now,
        deps
      );
      tx.set(markerRef, {
        kind: 'zalo_bot_webhook',
        eventName: 'consumeZaloBotLinkCode',
        messageId: input.webhookEventId,
        outcome: 'invalid_code',
        createdAt: now,
      });
      return { error: 'INVALID_CODE' };
    }

    const codeData = codeSnap.data();
    if (codeData.consumedAt) {
      await recordFailedAttempt(
        tx,
        db,
        chatIdHash,
        input.chatId,
        input.displayName,
        input.username,
        now,
        deps
      );
      tx.set(markerRef, {
        kind: 'zalo_bot_webhook',
        eventName: 'consumeZaloBotLinkCode',
        messageId: input.webhookEventId,
        outcome: 'invalid_code',
        createdAt: now,
      });
      return { error: 'INVALID_CODE' };
    }

    if (new Date(codeData.expiresAt).getTime() < new Date(now).getTime()) {
      await recordFailedAttempt(
        tx,
        db,
        chatIdHash,
        input.chatId,
        input.displayName,
        input.username,
        now,
        deps
      );
      tx.set(markerRef, {
        kind: 'zalo_bot_webhook',
        eventName: 'consumeZaloBotLinkCode',
        messageId: input.webhookEventId,
        outcome: 'invalid_code',
        createdAt: now,
      });
      return { error: 'INVALID_CODE' };
    }

    const claimRef = db.collection('zalo_bot_chat_claims').doc(chatIdHash);
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists && !claimSnap.data().released) {
      if (claimSnap.data().staffId !== codeData.staffId) {
        tx.set(markerRef, {
          kind: 'zalo_bot_webhook',
          eventName: 'consumeZaloBotLinkCode',
          messageId: input.webhookEventId,
          outcome: 'chat_already_claimed',
          createdAt: now,
        });
        return { error: 'CHAT_ALREADY_CLAIMED' };
      }
    }

    const linkRef = db.collection('zalo_bot_links').doc(codeData.staffId);
    const linkSnap = await tx.get(linkRef);
    if (linkSnap.exists && linkSnap.data().status === 'active') {
      const oldLinkData = linkSnap.data();
      if (oldLinkData.chatIdHash !== chatIdHash) {
        const oldClaimRef = db.collection('zalo_bot_chat_claims').doc(oldLinkData.chatIdHash);
        tx.update(oldClaimRef, { released: true, releasedAt: now });
      }
    }

    const linkData: ZaloBotLink = {
      staffId: codeData.staffId,
      chatId: input.chatId,
      chatIdHash,
      displayName: input.displayName,
      role: codeData.role,
      status: 'active',
      linkedMethod: 'self',
      linkedBy: codeData.staffId,
      linkedAt: now,
      lastSeenAt: now,
      updatedAt: now,
      confirmationStatus: 'pending',
    } as any;

    tx.update(codeRef, { consumedAt: now, consumedByChatIdHash: chatIdHash });
    tx.set(claimRef, { staffId: codeData.staffId, claimedAt: now, released: false });
    tx.set(linkRef, linkData);

    // Reset attempts on success
    if (pendingSnap.exists) {
      tx.update(pendingRef, { attemptCount: 0, blockedUntil: null });
    }

    tx.set(markerRef, {
      kind: 'zalo_bot_webhook',
      eventName: 'consumeZaloBotLinkCode',
      messageId: input.webhookEventId,
      outcome: 'linked',
      staffId: codeData.staffId,
      linkedAt: now,
      createdAt: now,
      confirmationStatus: 'pending',
    });

    return linkData;
  });

  if ('error' in result) {
    throw new Error(result.error);
  }

  return result;
}

async function recordFailedAttempt(
  tx: any,
  db: DocumentStore,
  chatIdHash: string,
  chatId: string,
  displayName: string,
  username: string | undefined,
  now: string,
  deps: LinkRepositoryDeps
) {
  const pendingRef = db.collection('zalo_bot_pending_chats').doc(chatIdHash);
  const pendingSnap = await tx.get(pendingRef);
  let attemptCount = 1;
  let blockedUntil = null;

  if (pendingSnap.exists) {
    const data = pendingSnap.data();
    attemptCount = (data.attemptCount || 0) + 1;
    if (attemptCount >= 5) {
      blockedUntil = new Date(new Date(now).getTime() + 15 * 60 * 1000).toISOString();
    }
    tx.update(pendingRef, { attemptCount, blockedUntil, lastSeenAt: now, displayName, username });
  } else {
    tx.set(pendingRef, {
      chatId,
      chatIdHash,
      displayName,
      username,
      firstSeenAt: now,
      lastSeenAt: now,
      attemptCount,
      blockedUntil,
    });
  }
}

export async function adminLinkZaloBotChat(
  db: DocumentStore,
  input: { staff: ZaloBotLinkActor; chatIdHash: string; adminId: string },
  deps: LinkRepositoryDeps
): Promise<ZaloBotLink> {
  const now = deps.now();

  return db.runTransaction(async (tx) => {
    const pendingRef = db.collection('zalo_bot_pending_chats').doc(input.chatIdHash);
    const pendingSnap = await tx.get(pendingRef);
    if (!pendingSnap.exists) {
      throw new Error('PENDING_CHAT_NOT_FOUND');
    }
    const pendingData = pendingSnap.data() as PendingZaloBotChat;

    const claimRef = db.collection('zalo_bot_chat_claims').doc(input.chatIdHash);
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists && !claimSnap.data().released) {
      if (claimSnap.data().staffId !== input.staff.uid) {
        throw new Error('CHAT_ALREADY_CLAIMED');
      }
    }

    const linkRef = db.collection('zalo_bot_links').doc(input.staff.uid);
    const linkSnap = await tx.get(linkRef);
    if (linkSnap.exists && linkSnap.data().status === 'active') {
      const oldLinkData = linkSnap.data();
      if (oldLinkData.chatIdHash !== input.chatIdHash) {
        const oldClaimRef = db.collection('zalo_bot_chat_claims').doc(oldLinkData.chatIdHash);
        tx.update(oldClaimRef, { released: true, releasedAt: now });
      }
    }

    const linkData: ZaloBotLink = {
      staffId: input.staff.uid,
      chatId: pendingData.chatId,
      chatIdHash: input.chatIdHash,
      displayName: pendingData.displayName,
      role: input.staff.role,
      status: 'active',
      linkedMethod: 'admin',
      linkedBy: input.adminId,
      linkedAt: now,
      lastSeenAt: now,
      updatedAt: now,
      confirmationStatus: 'pending',
    } as any;

    tx.set(claimRef, { staffId: input.staff.uid, claimedAt: now, released: false });
    tx.set(linkRef, linkData);
    tx.update(pendingRef, { attemptCount: 0, blockedUntil: null });

    return linkData;
  });
}

export async function disableZaloBotLink(
  db: DocumentStore,
  input: { staffId: string; actorId: string },
  deps: LinkRepositoryDeps
): Promise<void> {
  const now = deps.now();
  await db.runTransaction(async (tx) => {
    const linkRef = db.collection('zalo_bot_links').doc(input.staffId);
    const linkSnap = await tx.get(linkRef);
    if (!linkSnap.exists) return;

    const linkData = linkSnap.data() as ZaloBotLink;
    if (linkData.status === 'disabled') return;

    tx.update(linkRef, { status: 'disabled', updatedAt: now });

    const claimRef = db.collection('zalo_bot_chat_claims').doc(linkData.chatIdHash);
    const claimSnap = await tx.get(claimRef);
    if (
      claimSnap.exists &&
      !claimSnap.data().released &&
      claimSnap.data().staffId === input.staffId
    ) {
      tx.update(claimRef, { released: true, releasedAt: now });
    }
  });
}

export async function touchActiveZaloBotLinkFromWebhook(
  db: DocumentStore,
  input: { chatId: string; webhookEventId: string },
  deps: LinkRepositoryDeps
): Promise<'updated' | 'unlinked' | 'replayed'> {
  const chatIdHash = deps.hmac(deps.config.chatHashSecret, input.chatId);
  const now = deps.now();

  return db.runTransaction(async (tx) => {
    const markerRef = db.collection('_maintenance').doc(`zaloBotWebhook_${input.webhookEventId}`);
    const markerSnap = await tx.get(markerRef);
    if (markerSnap.exists) {
      return 'replayed';
    }

    const claimRef = db.collection('zalo_bot_chat_claims').doc(chatIdHash);
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists || claimSnap.data().released) {
      return 'unlinked';
    }

    const staffId = claimSnap.data().staffId;
    const linkRef = db.collection('zalo_bot_links').doc(staffId);
    const linkSnap = await tx.get(linkRef);
    if (
      !linkSnap.exists ||
      linkSnap.data().status !== 'active' ||
      linkSnap.data().chatIdHash !== chatIdHash
    ) {
      return 'unlinked';
    }

    tx.update(linkRef, { lastSeenAt: now });
    tx.set(markerRef, {
      kind: 'zalo_bot_webhook',
      eventName: 'touchActiveZaloBotLinkFromWebhook',
      messageId: input.webhookEventId,
      outcome: 'updated',
      staffId,
      createdAt: now,
    });

    return 'updated';
  });
}

export async function recordIgnoredZaloBotWebhookEvent(
  db: DocumentStore,
  input: { webhookEventId: string; eventName: string; outcome: string },
  deps: LinkRepositoryDeps
): Promise<'recorded' | 'replayed'> {
  const now = deps.now();
  const markerRef = db.collection('_maintenance').doc(`zaloBotWebhook_${input.webhookEventId}`);

  return db.runTransaction(async (tx) => {
    const markerSnap = await tx.get(markerRef);
    if (markerSnap.exists) {
      return 'replayed';
    }

    tx.set(markerRef, {
      kind: 'zalo_bot_webhook',
      eventName: input.eventName,
      messageId: input.webhookEventId,
      outcome: input.outcome,
      createdAt: now,
    });

    return 'recorded';
  });
}

export async function markZaloBotLinkNeedsRelink(
  db: DocumentStore,
  input: { chatId: string },
  deps: LinkRepositoryDeps
): Promise<void> {
  const chatIdHash = deps.hmac(deps.config.chatHashSecret, input.chatId);
  const now = deps.now();

  await db.runTransaction(async (tx) => {
    const claimRef = db.collection('zalo_bot_chat_claims').doc(chatIdHash);
    const claimSnap = await tx.get(claimRef);

    if (!claimSnap.exists || claimSnap.data()?.released) {
      return;
    }

    const staffId = claimSnap.data()?.staffId;
    if (!staffId) return;

    tx.update(claimRef, { released: true, releasedAt: now });

    const linkRef = db.collection('zalo_bot_links').doc(staffId);
    const linkSnap = await tx.get(linkRef);

    if (linkSnap.exists) {
      const linkData = linkSnap.data() as ZaloBotLink;
      if (linkData.chatIdHash === chatIdHash && linkData.status === 'active') {
        tx.update(linkRef, { status: 'needs_relink', updatedAt: now });
      }
    }
  });
}
