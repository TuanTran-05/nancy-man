import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ZaloBotChatIntent } from './chatTypes.js';

export const ZALO_BOT_CHAT_SESSION_TTL_MS = 15 * 60 * 1000;
const COLLECTION = 'zalo_bot_chat_sessions';

export type ZaloBotChatSession = {
  lastIntent: ZaloBotChatIntent;
  lastClassId: string | null;
  lastClassName: string | null;
};

/**
 * Ngữ cảnh câu hỏi trước, cố ý nghèo nàn.
 *
 * Chỉ đủ để hiểu "còn lớp kia thì sao". Không lưu nguyên văn tin nhắn, không
 * lưu tên hay số liệu học sinh — dữ liệu học sinh không có lý do gì để nằm
 * thêm một chỗ nữa trong DocumentStore.
 */
export async function readZaloBotChatSession(
  db: DocumentStore,
  staffId: string,
  now: string
): Promise<ZaloBotChatSession | null> {
  const snap = await db.collection(COLLECTION).doc(staffId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  const expiresAt = String(data.expiresAt || '');
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(now)) return null;

  return {
    lastIntent: data.lastIntent as ZaloBotChatIntent,
    lastClassId: (data.lastClassId as string | null) ?? null,
    lastClassName: (data.lastClassName as string | null) ?? null,
  };
}

export async function writeZaloBotChatSession(
  db: DocumentStore,
  input: {
    staffId: string;
    lastIntent: ZaloBotChatIntent;
    lastClassId: string | null;
    lastClassName: string | null;
    now: string;
  }
): Promise<void> {
  await db.collection(COLLECTION).doc(input.staffId).set({
    staffId: input.staffId,
    lastIntent: input.lastIntent,
    lastClassId: input.lastClassId,
    lastClassName: input.lastClassName,
    lastAskedAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + ZALO_BOT_CHAT_SESSION_TTL_MS).toISOString(),
  });
}
