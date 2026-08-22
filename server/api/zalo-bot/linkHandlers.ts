import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { loadZaloBotConfig } from './config.js';
import { getDb } from '../lib/auth/verifyAuth.js';
import {
  issueZaloBotLinkCode,
  adminLinkZaloBotChat,
  disableZaloBotLink,
  type LinkRepositoryDeps,
  type ZaloBotLinkActor,
  type PendingZaloBotChat,
} from './linkRepository.js';
import { writeRequiredAuditLog } from '../lib/logging/auditLog.js';
import type { UserContext } from '../lib/auth/authz.js';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import {
  isZaloBotStaffRole,
  ZALO_BOT_OUTBOX_JOB_TYPE,
  type ZaloBotStaffRole,
  type ZaloBotLink,
  type ZaloBotMessage,
} from '../../../shared/zaloBot.js';
import { normalizeBody, getString } from '../lib/http/helpers.js';
import { createOutboxJob } from '../lib/jobs/outbox.js';
import { createZaloBotMessageIfAbsent } from './messageRepository.js';
export type ZaloBotAdminOverview = {
  links: Array<Omit<ZaloBotLink, 'chatId'>>;
  pendingChats: Array<Omit<PendingZaloBotChat, 'chatId'>>;
  staff: Array<{
    uid: string;
    displayName: string;
    email: string;
    role: ZaloBotStaffRole;
  }>;
  recentMessages: Array<Omit<ZaloBotMessage, 'contentSnapshot'>>;
};

const LINK_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateZaloBotLinkCode(): string {
  return Array.from(
    randomBytes(8),
    (byte) => LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length]
  ).join('');
}

function getDeps(): LinkRepositoryDeps {
  const config = loadZaloBotConfig();
  return {
    now: () => new Date().toISOString(),
    generateCode: generateZaloBotLinkCode,
    hmac: (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex'),
    config,
  };
}

function toActor(context: UserContext): ZaloBotLinkActor {
  return {
    uid: context.uid,
    role: (context.role as ZaloBotStaffRole) || 'teacher',
    displayName: context.name || context.email || context.uid,
  };
}

export async function dispatchZaloBotSelfAction(
  action: string,
  req: ApiRequest,
  res: ApiResponse,
  context: UserContext
) {
  const db = getDb();
  const deps = getDeps();
  const actor = toActor(context);
  const botEnabled = deps.config.enabled;

  if (action === 'my-link') {
    if (req.method !== 'GET')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    const linkSnap = await db.collection('zalo_bot_links').doc(actor.uid).get();
    let link = null;
    if (linkSnap.exists) {
      const data = linkSnap.data() as ZaloBotLink;
      // Never return raw chatId
      const { chatId, ...safeData } = data;
      link = safeData;
    }
    return res.status(200).json({ success: true, link, botEnabled });
  }

  if (action === 'create-link-code') {
    if (req.method !== 'POST')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    if (!botEnabled)
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });

    const result = await issueZaloBotLinkCode(db, actor, deps);
    return res.status(200).json({ success: true, ...result });
  }

  if (action === 'unlink') {
    if (req.method !== 'POST')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    if (!botEnabled)
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });

    const linkSnap = await db.collection('zalo_bot_links').doc(actor.uid).get();
    if (linkSnap.exists) {
      const data = linkSnap.data() as ZaloBotLink;
      await disableZaloBotLink(db, { staffId: actor.uid, actorId: actor.uid }, deps);

      await writeRequiredAuditLog(db, {
        userId: actor.uid,
        userRole: actor.role,
        action: 'update',
        collection: 'zalo_bot_links',
        documentId: actor.uid,
        metadata: {
          linkedMethod: data.linkedMethod,
          linkStatus: 'disabled',
          chatIdHash: data.chatIdHash,
        },
      });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(404).json({ success: false, error: 'Not found' });
}

export async function dispatchZaloBotAdminAction(
  action: string,
  req: ApiRequest,
  res: ApiResponse,
  context: UserContext
) {
  const db = getDb();
  const deps = getDeps();
  const actor = toActor(context);
  const botEnabled = deps.config.enabled;

  if (action === 'admin-overview') {
    if (req.method !== 'GET')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const [linksSnap, pendingSnap, usersSnap, messagesSnap] = await Promise.all([
      db.collection('zalo_bot_links').get(),
      db.collection('zalo_bot_pending_chats').get(),
      db.collection('users').where('role', 'in', ['teacher', 'office', 'admin']).get(),
      db.collection('zalo_bot_messages').orderBy('createdAt', 'desc').limit(50).get(),
    ]);

    const links = linksSnap.docs.map((d) => {
      const { chatId, ...safeData } = d.data() as ZaloBotLink;
      return safeData;
    });

    const pendingChats = pendingSnap.docs.map((d) => {
      const { chatId, ...safeData } = d.data() as PendingZaloBotChat;
      return safeData;
    });

    const staff = usersSnap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: data.displayName || data.name || d.id,
        email: data.email || '',
        role: data.role as ZaloBotStaffRole,
      };
    });

    const recentMessages = messagesSnap.docs.map((d) => {
      const { contentSnapshot, ...safeData } = d.data() as ZaloBotMessage;
      return { id: d.id, ...safeData };
    });

    const overview: ZaloBotAdminOverview = {
      links,
      pendingChats,
      staff,
      recentMessages,
    };

    return res.status(200).json({ success: true, botEnabled, overview });
  }

  if (action === 'admin-link') {
    if (req.method !== 'POST')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    if (!botEnabled)
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });

    const body = normalizeBody(req.body);
    const staffId = getString(body, 'staffId');
    const chatIdHash = getString(body, 'chatIdHash');

    if (!staffId || !chatIdHash) {
      return res.status(400).json({ success: false, error: 'Missing staffId or chatIdHash' });
    }

    const userSnap = await db.collection('users').doc(staffId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }
    const userData = userSnap.data()!;
    if (!isZaloBotStaffRole(userData.role)) {
      return res.status(409).json({ success: false, error: 'Ineligible role' });
    }
    const targetStaff: ZaloBotLinkActor = {
      uid: staffId,
      role: userData.role,
      displayName: userData.displayName || userData.name || staffId,
    };

    try {
      const linkData = await adminLinkZaloBotChat(
        db,
        { staff: targetStaff, chatIdHash, adminId: actor.uid },
        deps
      );

      await writeRequiredAuditLog(db, {
        userId: actor.uid,
        userRole: actor.role,
        action: 'update',
        collection: 'zalo_bot_links',
        documentId: staffId,
        metadata: {
          linkedMethod: linkData.linkedMethod,
          linkStatus: linkData.status,
          chatIdHash: linkData.chatIdHash,
        },
      });

      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  if (action === 'admin-unlink') {
    if (req.method !== 'POST')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    if (!botEnabled)
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });

    const body = normalizeBody(req.body);
    const staffId = getString(body, 'staffId');

    if (!staffId) {
      return res.status(400).json({ success: false, error: 'Missing staffId' });
    }

    const linkSnap = await db.collection('zalo_bot_links').doc(staffId).get();
    if (linkSnap.exists) {
      const data = linkSnap.data() as ZaloBotLink;
      await disableZaloBotLink(db, { staffId, actorId: actor.uid }, deps);

      await writeRequiredAuditLog(db, {
        userId: actor.uid,
        userRole: actor.role,
        action: 'update',
        collection: 'zalo_bot_links',
        documentId: staffId,
        metadata: {
          linkedMethod: data.linkedMethod,
          linkStatus: 'disabled',
          chatIdHash: data.chatIdHash,
        },
      });
    }

    return res.status(200).json({ success: true });
  }

  if (action === 'admin-test') {
    if (req.method !== 'POST')
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    if (!botEnabled)
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });

    const body = normalizeBody(req.body);
    const staffId = getString(body, 'staffId');

    if (!staffId) {
      return res.status(400).json({ success: false, error: 'Missing staffId' });
    }

    const [userSnap, linkSnap] = await Promise.all([
      db.collection('users').doc(staffId).get(),
      db.collection('zalo_bot_links').doc(staffId).get(),
    ]);

    if (!userSnap.exists) {
      return res.status(409).json({ success: false, error: 'User not found' });
    }
    if (!linkSnap.exists) {
      return res.status(409).json({ success: false, error: 'Link not found' });
    }

    const userData = userSnap.data()!;
    const linkData = linkSnap.data() as ZaloBotLink;

    if (userData.blockedTeacher) {
      return res.status(409).json({ success: false, error: 'User is blocked' });
    }

    if (!['teacher', 'office', 'admin'].includes(userData.role)) {
      return res.status(409).json({ success: false, error: 'Ineligible role' });
    }

    if (linkData.status !== 'active') {
      return res.status(409).json({ success: false, error: 'Link is not active' });
    }

    if (userData.role !== linkData.role) {
      return res.status(409).json({ success: false, error: 'Role mismatch' });
    }

    const messageId = randomUUID();
    const fixedText = `Chào ${userData.displayName || userData.name || staffId}, đây là tin nhắn kiểm tra hệ thống từ admin.`;

    const message: ZaloBotMessage = {
      id: messageId,
      messageType: 'test',
      status: 'pending',
      staffId: staffId,
      role: userData.role as ZaloBotStaffRole,
      chatIdHash: linkData.chatIdHash,
      digestDate: deps.now().split('T')[0],
      contentSnapshot: fixedText,
      attempts: 0,
      createdAt: deps.now(),
      updatedAt: deps.now(),
      deliveryAmbiguous: false,
    };

    await createZaloBotMessageIfAbsent(db, message);

    await createOutboxJob(
      db,
      {
        type: ZALO_BOT_OUTBOX_JOB_TYPE,
        payload: { messageId },
        maxAttempts: 3,
      },
      { actorId: actor.uid, operation: 'zalo_bot:admin-test' }
    );

    return res.status(200).json({ success: true, messageId });
  }

  return res.status(404).json({ success: false, error: 'Not found' });
}
