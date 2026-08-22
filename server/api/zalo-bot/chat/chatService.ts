import type { DocumentStore } from '@/server/db/documentStore.js';
import type { ZaloBotConfig } from '../config.js';
import type { sendZaloBotText } from '../botClient.js';
import type { ZaloBotLink, ZaloBotMessage } from '../../../../shared/zaloBot.js';
import {
  ZALO_BOT_SENSITIVE_CONTENT_MARKER,
  ZALO_BOT_STAFF_ROLES,
} from '../../../../shared/zaloBot.js';
import { getVietnamTodayDateOnly } from '../../../../shared/classVisibility.js';
import { getUserContext } from '../../lib/auth/authz.js';
import { checkRateLimit } from '../../lib/auth/rateLimit.js';
import { createZaloBotMessageIfAbsent } from '../messageRepository.js';
import { classifyZaloBotChatQuestion } from './intentClassifier.js';
import { resolveZaloBotClass } from './classResolver.js';
import {
  runAttendanceToday,
  runClassEndDate,
  runClassStudentCount,
  runClassStudentList,
  runMyTodo,
} from './chatQueries.js';
import { composeZaloBotChatAnswer } from './answerComposer.js';
import { readZaloBotChatSession, writeZaloBotChatSession } from './chatSessionRepository.js';
import type { ZaloBotChatAnswer, ZaloBotChatIntent, ZaloBotChatQuestion } from './chatTypes.js';

export const ZALO_BOT_CHAT_RATE_LIMIT = 30;
export const ZALO_BOT_CHAT_RATE_WINDOW_MS = 60 * 60 * 1000;

export type ZaloBotChatDeps = {
  config: ZaloBotConfig;
  sendText: typeof sendZaloBotText;
  apiKey: string;
};

export type ZaloBotChatOutcome =
  | 'answered'
  | 'duplicate'
  | 'ineligible'
  | 'rate_limited'
  | 'send_failed';

const CLASS_SCOPED_INTENTS = new Set<ZaloBotChatIntent>([
  'class_student_count',
  'class_student_list',
  'class_end_date',
]);

export async function answerZaloBotChatMessage(
  db: DocumentStore,
  input: {
    staffId: string;
    chatId: string;
    text: string;
    zaloMessageId: string;
    now: string;
  },
  deps: ZaloBotChatDeps
): Promise<{ outcome: ZaloBotChatOutcome }> {
  const messageId = `chat_reply_${input.zaloMessageId}`;
  const messageRef = db.collection('zalo_bot_messages').doc(messageId);
  const digestDate = getVietnamTodayDateOnly(new Date(input.now));

  // (b) Quyền đọc lại tại thời điểm hỏi, không tin vào link đã lưu.
  const linkSnap = await db.collection('zalo_bot_links').doc(input.staffId).get();
  const link = linkSnap.data() as ZaloBotLink | undefined;
  if (!link || link.status !== 'active') return { outcome: 'ineligible' };

  const actor = await getUserContext(db, { uid: input.staffId });
  if (actor.isBlocked) return { outcome: 'ineligible' };
  if (!actor.role || !(ZALO_BOT_STAFF_ROLES as readonly string[]).includes(actor.role)) {
    return { outcome: 'ineligible' };
  }
  if (actor.role !== link.role) return { outcome: 'ineligible' };
  // Không chỉ tin staffId do webhook truyền vào. Sau unlink/relink, một event cũ
  // có thể vẫn mang staffId đúng nhưng chatId cũ; gửi vào chat đó sẽ rò dữ liệu.
  if (link.chatId !== input.chatId) return { outcome: 'ineligible' };

  // Fast path cho replay thông thường: không tiêu rate-limit. Transaction create
  // bên dưới vẫn là chốt authoritative cho hai request đồng thời.
  const existingLedger = await messageRef.get();
  if (existingLedger.exists) return { outcome: 'duplicate' };

  async function isStillEligibleToReceiveReply(): Promise<boolean> {
    const [currentLinkSnap, currentActor] = await Promise.all([
      db.collection('zalo_bot_links').doc(input.staffId).get(),
      getUserContext(db, { uid: input.staffId }),
    ]);
    const currentLink = currentLinkSnap.data() as ZaloBotLink | undefined;
    if (!currentLink || currentLink.status !== 'active') return false;
    if (currentActor.isBlocked || currentActor.role !== actor.role) return false;
    if (currentLink.role !== currentActor.role) return false;
    if (
      currentLink.chatId !== input.chatId ||
      !currentLink.chatIdHash ||
      currentLink.chatIdHash !== link.chatIdHash
    ) {
      return false;
    }

    const claimSnap = await db.collection('zalo_bot_chat_claims').doc(currentLink.chatIdHash).get();
    const claim = claimSnap.data() || {};
    return (
      claimSnap.exists && claim.released !== true && String(claim.staffId || '') === input.staffId
    );
  }

  async function replyText(
    text: string,
    options: { sensitive?: boolean } = {}
  ): Promise<ZaloBotChatOutcome> {
    let providerAccepted = false;
    try {
      // Quyền và đích nhận có thể đổi trong lúc Gemini/query đang chạy. Kiểm
      // lại sát sendText để một thao tác block/unlink/relink có hiệu lực trước
      // khi câu trả lời chứa dữ liệu học sinh rời server.
      if (!(await isStillEligibleToReceiveReply())) {
        await messageRef.update({
          status: 'skipped',
          errorCode: 'recipient_no_longer_eligible',
          errorMessage: 'User, link, or chat claim changed before delivery',
          updatedAt: new Date().toISOString(),
        });
        return 'ineligible';
      }

      await messageRef.update({
        contentSnapshot: options.sensitive ? ZALO_BOT_SENSITIVE_CONTENT_MARKER : text,
        updatedAt: input.now,
      });
      const sent = await deps.sendText({ chatId: input.chatId, text }, deps.config);
      providerAccepted = true;
      await messageRef.update({
        status: 'sent',
        providerMessageId: sent.messageId,
        updatedAt: new Date().toISOString(),
      });
      return 'answered';
    } catch (err) {
      try {
        await messageRef.update({
          status: 'failed',
          errorCode: providerAccepted ? 'ledger_finalize_failed' : 'send_failed',
          errorMessage: providerAccepted
            ? 'Provider accepted reply but ledger finalization failed'
            : 'Zalo reply delivery failed',
          deliveryAmbiguous: providerAccepted,
          updatedAt: new Date().toISOString(),
        });
      } catch (ledgerErr) {
        console.error('[zaloBotChat] failed to finalize reply ledger', {
          messageId,
          errorType: ledgerErr instanceof Error ? ledgerErr.name : 'unknown_error',
        });
      }
      return 'send_failed';
    }
  }

  async function reply(
    answer: ZaloBotChatAnswer,
    options: { sensitive?: boolean } = {}
  ): Promise<ZaloBotChatOutcome> {
    return replyText(composeZaloBotChatAnswer(answer), options);
  }

  async function failWithApology(err: unknown): Promise<ZaloBotChatOutcome> {
    console.error('[zaloBotChat] answer pipeline failed', {
      messageId,
      staffId: input.staffId,
      errorType: err instanceof Error ? err.name : 'unknown_error',
    });
    try {
      await messageRef.update({
        errorCode: 'answer_failed',
        errorMessage: 'Chat answer pipeline failed',
        updatedAt: new Date().toISOString(),
      });
    } catch (ledgerErr) {
      console.error('[zaloBotChat] failed to record answer error', {
        messageId,
        errorType: ledgerErr instanceof Error ? ledgerErr.name : 'unknown_error',
      });
    }
    return reply({ kind: 'error' });
  }

  // (a) Rate limit trước khi tạo bất kỳ bản ghi nào.
  const { allowed } = await checkRateLimit(
    db,
    `zalo_bot_chat:${input.staffId}`,
    ZALO_BOT_CHAT_RATE_LIMIT,
    ZALO_BOT_CHAT_RATE_WINDOW_MS,
    { failClosed: true }
  );

  // (c) Ledger trước khi gọi Gemini: một webhook được giao lại phải dừng
  // trước khi tốn một lần gọi mô hình, không phải sau.
  const ledger: ZaloBotMessage = {
    id: messageId,
    staffId: input.staffId,
    role: actor.role as ZaloBotMessage['role'],
    chatIdHash: link.chatIdHash,
    digestDate,
    messageType: 'chat_reply',
    contentSnapshot: '',
    status: 'pending',
    attempts: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const created = await createZaloBotMessageIfAbsent(db, ledger);
  if (created === 'existing') return { outcome: 'duplicate' };

  if (!allowed) {
    const replyOutcome = await reply({ kind: 'rate_limited' });
    return { outcome: replyOutcome === 'send_failed' ? 'send_failed' : 'rate_limited' };
  }

  try {
    let preclassifiedBaseQuestion: ZaloBotChatQuestion | null = null;

    // Admin assistant dispatcher (only for admin role with feature flag enabled)
    if (actor.role === 'admin' && deps.config.adminDataEnabled) {
      const { dispatchAdminChatMessage } = await import('./admin/adminChatDispatcher.js');
      const adminDispatch = await dispatchAdminChatMessage(db, input, deps, actor);
      if (adminDispatch.handled) {
        const replyOutcome = await replyText(adminDispatch.text, {
          sensitive: adminDispatch.isSensitive,
        });
        return { outcome: replyOutcome };
      }
      preclassifiedBaseQuestion =
        'baseQuestion' in adminDispatch ? (adminDispatch.baseQuestion ?? null) : null;
    }

    // (d) Ngữ cảnh ngắn cho giáo viên / nhân viên.
    const session = await readZaloBotChatSession(db, input.staffId, input.now);

    // (e) Phân loại. Mọi thứ trả về từ đây là dữ liệu không tin cậy.
    const question =
      preclassifiedBaseQuestion ??
      (await classifyZaloBotChatQuestion({
        text: input.text,
        apiKey: deps.apiKey,
        previousClassName: session?.lastClassName ?? null,
      }));

    let answer: ZaloBotChatAnswer;
    let resolvedClassId: string | null = null;
    let resolvedClassName: string | null = null;

    if (question.intent === 'unsupported') {
      answer = { kind: 'unsupported' };
    } else if (CLASS_SCOPED_INTENTS.has(question.intent)) {
      // (f) Giải tên lớp trong tập được phép.
      const hint = question.classNameHint ?? session?.lastClassName ?? null;
      const resolved = await resolveZaloBotClass(db, actor, hint);

      if (resolved.kind === 'not_found') {
        answer = { kind: 'class_not_found', hint: hint ?? '' };
      } else if (resolved.kind === 'ambiguous') {
        answer = {
          kind: 'class_ambiguous',
          candidates: resolved.candidates.map((row) => row.className),
        };
      } else {
        resolvedClassId = resolved.classId;
        resolvedClassName = resolved.className;
        const target = { classId: resolved.classId, className: resolved.className };
        // (g) + (h) Executor tự gọi assertClassAccess trước khi đọc.
        if (question.intent === 'class_student_count') {
          answer = await runClassStudentCount(db, actor, target);
        } else if (question.intent === 'class_student_list') {
          answer = await runClassStudentList(db, actor, target);
        } else {
          answer = await runClassEndDate(db, actor, target);
        }
      }
    } else if (question.intent === 'attendance_today') {
      answer = await runAttendanceToday(db, actor, digestDate);
    } else {
      answer = await runMyTodo(db, actor, digestDate);
    }

    // Session là tiện ích, không phải điều kiện để trả lời. Giữ class context
    // cũ qua attendance/my_todo/unsupported và không để write lỗi làm bot im lặng.
    try {
      await writeZaloBotChatSession(db, {
        staffId: input.staffId,
        lastIntent: question.intent,
        lastClassId: resolvedClassId ?? session?.lastClassId ?? null,
        lastClassName: resolvedClassName ?? session?.lastClassName ?? null,
        now: input.now,
      });
    } catch (sessionErr) {
      console.warn('[zaloBotChat] session write failed', {
        staffId: input.staffId,
        errorType: sessionErr instanceof Error ? sessionErr.name : 'unknown_error',
      });
    }

    // (i) Gửi và cập nhật ledger.
    return {
      outcome: await reply(answer, {
        sensitive: actor.role === 'admin' && deps.config.adminDataEnabled,
      }),
    };
  } catch (err) {
    return { outcome: await failWithApology(err) };
  }
}
