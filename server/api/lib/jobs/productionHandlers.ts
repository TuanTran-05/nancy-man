import { getDb } from '../auth/verifyAuth.js';
import { sendReceiptPaymentConfirmation } from '../../finance/handlers/shared.js';
import { registerOutboxHandler } from './outbox.js';
import { z } from 'zod';
import { rebuildAccountingStudentSummary } from '../services/accountingStudentSummaryService.js';
import { deliverZaloBotMessage } from '../../zalo-bot/deliveryService.js';
import { loadZaloBotConfig } from '../../zalo-bot/config.js';
import { sendZaloBotText } from '../../zalo-bot/botClient.js';
import { ZALO_BOT_OUTBOX_JOB_TYPE } from '../../../../shared/zaloBot.js';

let handlersInitialized = false;

export function initOutboxHandlers() {
  if (handlersInitialized) return;
  handlersInitialized = true;

  registerOutboxHandler('send_zalo_receipt_confirmation', async (payload: any) => {
    const db = getDb();
    await sendReceiptPaymentConfirmation(db, payload.receipt);
  });

  registerOutboxHandler(ZALO_BOT_OUTBOX_JOB_TYPE, async (payload: unknown) => {
    const parsed = z.object({ messageId: z.string().min(1) }).parse(payload);
    await deliverZaloBotMessage(getDb(), parsed, {
      config: loadZaloBotConfig(),
      sendText: sendZaloBotText,
    });
  });

  registerOutboxHandler('rebuild_accounting_student_summary', async (payload: unknown) => {
    const parsed = z.object({ studentId: z.string().min(1) }).parse(payload);
    await rebuildAccountingStudentSummary(getDb(), parsed.studentId);
  });

  registerOutboxHandler('materialize_course_closing_document', async (payload: unknown) => {
    const parsed = z
      .object({
        recordId: z.string().min(1),
        documentType: z.enum(['evaluation', 'tuition']),
        templateVersion: z.literal(1),
        force: z.boolean().optional(),
      })
      .parse(payload);
    const { materializeCourseClosingDocument } =
      await import('../../classes/records/courseClosingRecordMaterializer.js');
    await materializeCourseClosingDocument(getDb(), parsed);
  });

  registerOutboxHandler('rebuild_admin_class_tuition_summary', async (payload: unknown) => {
    const config = loadZaloBotConfig();
    if (!config.adminSnapshotRefreshEnabled) return;
    const parsed = z
      .object({
        classId: z.string().min(1),
        termStart: z.string().min(1),
      })
      .parse(payload);
    const { buildAndSaveClassTuitionSnapshot } =
      await import('../services/adminClassTuitionSnapshotService.js');
    await buildAndSaveClassTuitionSnapshot(getDb(), parsed.classId, parsed.termStart);
  });
}
