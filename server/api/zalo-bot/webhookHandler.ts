import { z } from 'zod';
import { answerZaloBotChatMessage } from './chat/chatService.js';
import { sendZaloBotText } from './botClient.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { timingSafeEqual, createHmac, randomBytes } from 'crypto';
import { loadZaloBotConfig } from './config.js';
import { getDb } from '../lib/auth/verifyAuth.js';
import { normalizeBody } from '../lib/http/helpers.js';
import {
  consumeZaloBotLinkCode,
  touchActiveZaloBotLinkFromWebhook,
  recordPendingZaloBotChat,
  recordIgnoredZaloBotWebhookEvent,
  type LinkRepositoryDeps,
} from './linkRepository.js';
import { ensureZaloBotLinkConfirmation } from './linkConfirmationService.js';
import { parseZaloBotLinkCommand } from '../../../shared/zaloBot.js';
import { runInBackground } from '../../runtime/backgroundTasks.js';

const zaloBotUpdateSchema = z.object({
  event_name: z.string().min(1),
  message: z
    .object({
      from: z.object({
        id: z.string().min(1),
        display_name: z.string().default(''),
        username: z.string().optional(),
        is_bot: z.boolean().optional(),
      }),
      chat: z.object({
        id: z.string().min(1),
        chat_type: z.enum(['PRIVATE', 'GROUP']),
      }),
      text: z.string().optional(),
      message_id: z.string().min(1),
      date: z.number().optional(),
    })
    .optional(),
});

// Tài liệu Zalo mô tả webhook body bọc trong { ok, result }, nhưng update thật
// quan sát được (getUpdates, 2026-08-16) là object phẳng { event_name, message }.
// Chấp nhận cả hai: chỉ một hình dạng thì mọi tin nhắn thật rơi vào 400 và biến
// mất không dấu vết, vì 400 xảy ra trước khi bất kỳ marker nào được ghi.
const zaloBotWebhookSchema = z.union([
  z
    .object({ ok: z.literal(true), result: zaloBotUpdateSchema })
    .transform((envelope) => envelope.result),
  zaloBotUpdateSchema,
]);

function getDeps(): LinkRepositoryDeps {
  const config = loadZaloBotConfig();
  return {
    now: () => new Date().toISOString(),
    generateCode: () => randomBytes(4).toString('hex').toUpperCase(),
    hmac: (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex'),
    config,
  };
}

export async function handleZaloBotWebhook(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // Configuration could be disabled, but webhook still authenticates and acknowledges safely.
  const config = loadZaloBotConfig();

  // Authentication check before body parsing
  const tokenHeader = req.headers['x-bot-api-secret-token'];
  const providedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader || '';
  const expectedSecret = config.webhookSecret;

  if (
    !providedToken ||
    providedToken.length !== expectedSecret.length ||
    !timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedSecret))
  ) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const rawBody = normalizeBody(req.body);
  const parsed = zaloBotWebhookSchema.safeParse(rawBody);

  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Malformed body' });
  }

  const update = parsed.data;
  const message = update.message;

  if (!message) {
    // Non-message event or valid update without text/message
    // Return ignored but we might need a message ID? The webhookEventId can be random if not provided?
    // Wait, the spec says "All mutations are idempotent via webhookEventId = message.message_id"
    // And "Valid update without text returns 200 ignored"
    return res.status(200).json({ ignored: true });
  }

  const webhookEventId = message.message_id;

  if (message.chat.chat_type === 'GROUP') {
    return res.status(200).json({ ignored: true, reason: 'group_chat_not_supported' });
  }

  const db = getDb();
  const deps = getDeps();

  if (!message.text) {
    await recordIgnoredZaloBotWebhookEvent(
      db,
      { webhookEventId, eventName: update.event_name, outcome: 'ignored_no_text' },
      deps
    );
    return res.status(200).json({ ignored: true });
  }

  const linkCode = parseZaloBotLinkCommand(message.text);

  if (linkCode) {
    if (!config.enabled) {
      // "When ZALO_BOT_ENABLED=false, code/link mutations return 503"
      // Wait, "webhook still authenticates and acknowledges safely even when disabled"
      // If it's a link command, should it return 503 or just record pending/ignored?
      // Wait, returning 503 is okay but maybe it's cleaner to return 503 with errorCode.
      return res.status(503).json({ success: false, errorCode: 'zalo_bot_disabled' });
    }

    try {
      const link = await consumeZaloBotLinkCode(
        db,
        {
          code: linkCode,
          chatId: message.chat.id,
          displayName: message.from.display_name,
          username: message.from.username,
          webhookEventId,
        },
        deps
      );

      await ensureZaloBotLinkConfirmation(db, {
        staffId: link.staffId,
        linkedAt: link.linkedAt,
      });

      await db.collection('_maintenance').doc(`zaloBotWebhook_${webhookEventId}`).update({
        confirmationStatus: 'enqueued',
      });

      return res.status(200).json({ success: true });
    } catch (err: any) {
      if (
        err.message === 'INVALID_CODE' ||
        err.message === 'BLOCKED' ||
        err.message === 'CHAT_ALREADY_CLAIMED'
      ) {
        // Just ignore/acknowledge to Zalo, as errors are recorded in DB attempt counts
        return res.status(200).json({ ignored: true, error: err.message });
      }
      if (err.message === 'WEBHOOK_ALREADY_PROCESSED') {
        // Replay idempotent handling
        const markerSnap = await db
          .collection('_maintenance')
          .doc(`zaloBotWebhook_${webhookEventId}`)
          .get();
        if (markerSnap.exists) {
          const data = markerSnap.data()!;
          if (data.outcome === 'linked' && data.staffId && data.linkedAt) {
            await ensureZaloBotLinkConfirmation(db, {
              staffId: data.staffId,
              linkedAt: data.linkedAt,
            });
            await db.collection('_maintenance').doc(`zaloBotWebhook_${webhookEventId}`).update({
              confirmationStatus: 'enqueued',
            });
          }
        }
        return res.status(200).json({ success: true });
      }
      throw err;
    }
  }

  // Not a link command, so it's a normal message
  const outcome = await touchActiveZaloBotLinkFromWebhook(
    db,
    { chatId: message.chat.id, webhookEventId },
    deps
  );

  if (outcome === 'unlinked') {
    await recordPendingZaloBotChat(
      db,
      {
        chatId: message.chat.id,
        displayName: message.from.display_name,
        username: message.from.username,
        webhookEventId,
      },
      deps
    );
    return res.status(200).json({ ignored: true });
  }

  if (!config.enabled || !config.chatEnabled) {
    return res.status(200).json({ ignored: true });
  }

  // Chat đã liên kết: giải staffId từ claim rồi trả lời ngoài chu kỳ request.
  const chatIdHash = deps.hmac(config.chatHashSecret, message.chat.id);
  const claimSnap = await db.collection('zalo_bot_chat_claims').doc(chatIdHash).get();
  const claim = claimSnap.data() || {};
  const staffId = claimSnap.exists && claim.released !== true ? String(claim.staffId || '') : '';

  if (!staffId) {
    return res.status(200).json({ ignored: true });
  }

  const linkSnap = await db.collection('zalo_bot_links').doc(staffId).get();
  const link = linkSnap.data() || {};
  if (
    !linkSnap.exists ||
    link.status !== 'active' ||
    String(link.chatId || '') !== message.chat.id ||
    String(link.chatIdHash || '') !== chatIdHash
  ) {
    return res.status(200).json({ ignored: true });
  }

  const apiKey = process.env.GEMINI_API_KEY || '';
  const chatText = message.text;
  const chatMessageId = webhookEventId;
  const chatId = message.chat.id;

  runInBackground(
    answerZaloBotChatMessage(
      db,
      {
        staffId,
        chatId,
        text: chatText,
        zaloMessageId: chatMessageId,
        now: new Date().toISOString(),
      },
      { config, sendText: sendZaloBotText, apiKey }
    ).catch((err) => {
      console.error('[zaloBotChat] answer failed', {
        staffId,
        zaloMessageId: chatMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
    'zalo-bot-chat'
  );

  return res.status(200).json({ accepted: true });
}
