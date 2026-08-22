import type { DocumentStore } from '@/server/db/documentStore.js';
import type { UserContext } from '../../../lib/auth/authz.js';
import type { ZaloBotChatDeps } from '../chatService.js';
import {
  queryAdminStudentAcademic,
  queryAdminZaloOperations,
} from './adminAcademicAndOpsQueries.js';
import { queryAdminClassCoursePeriod, queryAdminClassTuition } from './adminCourseQueries.js';
import {
  queryAdminCenterHeadcount,
  queryAdminStudentLookup,
  queryAdminStudentPhone,
} from './adminDirectoryQueries.js';
import {
  normalizeVietnameseSearchText,
  resolveClass,
  resolveStudent,
  resolveTeacher,
} from './adminEntityResolver.js';
import { queryAdminCenterFinance } from './adminFinanceQueries.js';
import { classifyAdminChatQuestion } from './adminIntentClassifier.js';
import {
  formatAdminQueryResult,
  formatDisambiguationMessage,
  formatNotFoundMessage,
  type FormattedAdminMessage,
} from './adminMessageFormatter.js';
import { queryAdminTeacherPayroll } from './adminPayrollQueries.js';
import { queryAdminRanking } from './adminRankingQueries.js';
import {
  recordAdminDataReadAudit,
  type AdminReadAuditParams,
  type AdminReadSensitivityTier,
} from './adminReadAuditRepository.js';
import { toSafeAdminError } from './adminSafeError.js';
import { getAdminSession, saveAdminSession } from './adminSessionRepository.js';
import { sanitizeAdminQuestion } from './adminQuestionSanitizer.js';
import type { AdminQueryResult } from './adminChatTypes.js';
import { BASE_CHAT_INTENTS } from '../../../../../shared/adminChatMetrics.js';
import type { ZaloBotChatQuestion } from '../chatTypes.js';

export type AdminChatDispatchResult =
  | { handled: true; text: string; isSensitive: boolean }
  | { handled: false; baseQuestion?: ZaloBotChatQuestion };

function isGreetingOrHelpText(text: string): 'greeting' | 'help' | 'goodbye' | 'thanks' | null {
  const norm = normalizeVietnameseSearchText(text);
  if (
    /^(?:xin\s+)?chao(?:\s+bot|\s+admin|\s+ad|\s+em|\s+ban)?$/i.test(norm) ||
    norm === 'hello' ||
    norm === 'hi'
  ) {
    return 'greeting';
  }
  if (/^(?:huong\s+dan|tro\s+giup|help|menu|\?)$/i.test(norm)) {
    return 'help';
  }
  if (/^(?:tam\s+biet|bye|goodbye|hen\s+gap\s+lai)$/i.test(norm)) {
    return 'goodbye';
  }
  if (/^(?:cam\s+on|thank\s+you|thanks|cmon|tks)$/i.test(norm)) {
    return 'thanks';
  }
  return null;
}

/**
 * Dispatches and answers an admin natural language query against EduTrack canonical data.
 */
export async function dispatchAdminChatMessage(
  db: DocumentStore,
  input: {
    staffId: string;
    chatId: string;
    text: string;
    zaloMessageId: string;
    now: string;
  },
  deps: ZaloBotChatDeps,
  actor: UserContext
): Promise<AdminChatDispatchResult> {
  if (!deps.config.adminDataEnabled) {
    return { handled: false };
  }

  if (
    deps.config.adminPilotUids.length > 0 &&
    !deps.config.adminPilotUids.includes(input.staffId)
  ) {
    return { handled: false };
  }

  const nowDate = new Date(input.now);

  // Fast-path deterministic handling for greetings / help
  const fastBase = isGreetingOrHelpText(input.text);
  if (fastBase === 'greeting') {
    return {
      handled: true,
      text: 'Xin chào Quản trị viên! Tôi là Trợ lý Dữ liệu EduTrack. Tôi có thể hỗ trợ tra cứu học phí, sĩ số, báo cáo tài chính, lương giáo viên và thông tin học viên.',
      isSensitive: false,
    };
  }
  if (fastBase === 'help') {
    return {
      handled: true,
      text: `💡 **DANH MỤC TRA CỨU DÀNH CHO QUẢN TRỊ VIÊN:**\n\n1. **Học sinh:** "Tìm học sinh [Tên]", "SĐT phụ huynh [Tên]", "Học phí [Tên] đóng chưa", "Điểm thi của [Tên]"\n2. **Lớp học:** "Học phí lớp [Tên lớp]", "Thời gian khóa học lớp [Tên lớp]"\n3. **Xếp hạng:** "Lớp nào nợ nhiều nhất?", "Lớp sắp thu xong?", "Lớp thu xong 100%"\n4. **Tài chính & Sĩ số:** "Doanh thu tháng này", "Sĩ số toàn trung tâm", "Lương giáo viên tháng này"\n5. **Hệ thống:** "Trạng thái tin nhắn Zalo"`,
      isSensitive: false,
    };
  }
  if (fastBase === 'goodbye') {
    return {
      handled: true,
      text: 'Tạm biệt Quản trị viên! Chúc bạn một ngày làm việc hiệu quả.',
      isSensitive: false,
    };
  }
  if (fastBase === 'thanks') {
    return {
      handled: true,
      text: 'Rất vui được hỗ trợ bạn! Nếu cần tra cứu thêm thông tin gì, bạn cứ nhắn nhé.',
      isSensitive: false,
    };
  }

  const sanitized = sanitizeAdminQuestion(input.text);
  const session = await getAdminSession(db, input.staffId, nowDate);

  const classification = await classifyAdminChatQuestion({
    text: sanitized.sanitizedText,
    apiKey: deps.apiKey,
  });

  if (classification.intent === 'unsupported') {
    return {
      handled: true,
      text: 'Tôi chưa hỗ trợ loại yêu cầu này. Vui lòng chọn một mục trong phần trợ giúp.',
      isSensitive: false,
    };
  }

  if ((BASE_CHAT_INTENTS as readonly string[]).includes(classification.intent)) {
    return {
      handled: false,
      baseQuestion: {
        intent: classification.intent as ZaloBotChatQuestion['intent'],
        classNameHint: classification.classHint ?? null,
      },
    };
  }

  if (!deps.config.adminIntentsEnabled.includes(classification.intent as any)) {
    return {
      handled: true,
      text: 'Tính năng tra cứu này hiện đang tạm tắt để bảo trì hệ thống.',
      isSensitive: false,
    };
  }

  const sensitivityTier: AdminReadSensitivityTier =
    classification.intent === 'admin_student_phone'
      ? 'critical_pii'
      : [
            'admin_student_tuition',
            'admin_center_finance',
            'admin_class_tuition',
            'admin_class_tuition_ranking',
            'admin_teacher_payroll',
            'admin_student_academic',
          ].includes(classification.intent)
        ? 'high'
        : 'medium';

  const writeAudit = (
    accessStage: AdminReadAuditParams['accessStage'],
    details: Partial<
      Pick<AdminReadAuditParams, 'canonicalIds' | 'classIds' | 'period' | 'resultCount'>
    > = {}
  ) =>
    recordAdminDataReadAudit(
      db,
      {
        actorUid: input.staffId,
        actorRole: actor.role,
        messageId: input.zaloMessageId,
        accessStage,
        queryKind: classification.intent,
        sensitivityTier,
        ...details,
      },
      {
        hmacSecret: deps.config.chatHashSecret,
        now: nowDate,
      }
    );

  await writeAudit('started');

  try {
    let queryResult: AdminQueryResult | null = null;
    let formattedMessage: FormattedAdminMessage;
    let canonicalIds: string[] = [];
    let classIds: string[] = [];

    if (
      classification.intent === 'admin_student_lookup' ||
      classification.intent === 'admin_student_phone' ||
      classification.intent === 'admin_student_tuition' ||
      classification.intent === 'admin_student_academic'
    ) {
      const studentResolution = await resolveStudent(db, {
        studentHint: classification.studentHint,
        teacherHint: classification.teacherHint,
        classHint: classification.classHint,
        rawQuestionText: input.text,
        session,
      });

      if (studentResolution.status === 'ambiguous') {
        await saveAdminSession(
          db,
          {
            staffId: input.staffId,
            pendingCandidateIds: studentResolution.candidates.map((candidate) => candidate.id),
          },
          nowDate
        );
        await writeAudit('completed', {
          canonicalIds: studentResolution.candidates.map((candidate) => candidate.id),
          resultCount: studentResolution.candidates.length,
        });
        formattedMessage = formatDisambiguationMessage(
          studentResolution.candidates,
          studentResolution.omittedCount
        );
        return {
          handled: true,
          text: formattedMessage.text,
          isSensitive: formattedMessage.isSensitive,
        };
      }

      if (studentResolution.status === 'not_found') {
        await writeAudit('completed', { resultCount: 0 });
        formattedMessage = formatNotFoundMessage(studentResolution.hint, 'học sinh');
        return {
          handled: true,
          text: formattedMessage.text,
          isSensitive: formattedMessage.isSensitive,
        };
      }

      if (studentResolution.status === 'empty_hint') {
        await writeAudit('completed', { resultCount: 0 });
        formattedMessage = {
          text: 'Vui lòng cung cấp tên hoặc mã học sinh bạn muốn tra cứu.',
          suggestedPrompts: ['Sĩ số toàn trung tâm', 'Doanh thu tháng này'],
          isSensitive: false,
        };
        return {
          handled: true,
          text: formattedMessage.text,
          isSensitive: false,
        };
      }

      const resolvedStudent = studentResolution.student;
      canonicalIds = [resolvedStudent.id];
      if (resolvedStudent.currentClassId) classIds = [resolvedStudent.currentClassId];

      await saveAdminSession(
        db,
        {
          staffId: input.staffId,
          lastStudentId: resolvedStudent.id,
          lastClassId: resolvedStudent.currentClassId ?? undefined,
          lastTeacherId: resolvedStudent.currentTeacherId ?? undefined,
        },
        nowDate
      );

      if (classification.intent === 'admin_student_lookup') {
        queryResult = await queryAdminStudentLookup(db, resolvedStudent, nowDate);
      } else if (classification.intent === 'admin_student_phone') {
        queryResult = await queryAdminStudentPhone(db, resolvedStudent, nowDate);
      } else if (classification.intent === 'admin_student_tuition') {
        const { queryAdminStudentTuition } = await import('./adminTuitionQueries.js');
        queryResult = await queryAdminStudentTuition(db, resolvedStudent, nowDate);
      } else {
        queryResult = await queryAdminStudentAcademic(db, resolvedStudent, nowDate);
      }
    } else if (
      classification.intent === 'admin_class_tuition' ||
      classification.intent === 'admin_class_course_period'
    ) {
      const classResolution = await resolveClass(db, classification.classHint);

      if (classResolution.status === 'not_found' || classResolution.status === 'empty_hint') {
        await writeAudit('completed', { resultCount: 0 });
        formattedMessage = formatNotFoundMessage(classification.classHint || 'lớp', 'lớp học');
        return {
          handled: true,
          text: formattedMessage.text,
          isSensitive: formattedMessage.isSensitive,
        };
      }

      if (classResolution.status === 'ambiguous') {
        await writeAudit('completed', {
          classIds: classResolution.candidates.map((candidate) => candidate.classId),
          resultCount: classResolution.candidates.length,
        });
        const lines = ['🔍 **Tìm thấy nhiều lớp học trùng khớp:**\n'];
        classResolution.candidates.forEach((c, i) => {
          lines.push(`${i + 1}. **${c.className}** (GV: ${c.teacherName})`);
        });
        lines.push('\n💡 *Vui lòng chỉ định tên lớp rõ hơn.*');
        return {
          handled: true,
          text: lines.join('\n'),
          isSensitive: true,
        };
      }

      const resolvedClass = classResolution.classObj;
      classIds = [resolvedClass.classId];

      await saveAdminSession(
        db,
        {
          staffId: input.staffId,
          lastClassId: resolvedClass.classId,
          lastTeacherId: resolvedClass.teacherId,
        },
        nowDate
      );

      if (classification.intent === 'admin_class_tuition') {
        queryResult = await queryAdminClassTuition(db, resolvedClass, nowDate);
      } else {
        queryResult = await queryAdminClassCoursePeriod(db, resolvedClass, nowDate);
      }
    } else if (classification.intent === 'admin_class_tuition_ranking') {
      const criterion = classification.ranking || 'highest_outstanding';
      queryResult = await queryAdminRanking(db, { criterion, limit: 10 }, nowDate);
    } else if (classification.intent === 'admin_center_finance') {
      queryResult = await queryAdminCenterFinance(
        db,
        {
          period: classification.period,
          requestedMetrics: classification.metrics as any,
        },
        nowDate
      );
    } else if (classification.intent === 'admin_center_headcount') {
      queryResult = await queryAdminCenterHeadcount(db, nowDate);
    } else if (classification.intent === 'admin_teacher_payroll') {
      let resolvedTeacher = null;
      if (classification.teacherHint) {
        const teacherRes = await resolveTeacher(db, classification.teacherHint);
        if (teacherRes.status === 'resolved') {
          resolvedTeacher = teacherRes.teacher;
        } else {
          await writeAudit('completed', { resultCount: 0 });
          if (teacherRes.status === 'ambiguous') {
            return {
              handled: true,
              text: [
                'Tìm thấy nhiều giáo viên trùng khớp:',
                ...teacherRes.candidates
                  .slice(0, 10)
                  .map((candidate, index) => `${index + 1}. ${candidate.teacherName}`),
                'Vui lòng nhập rõ hơn tên giáo viên.',
              ].join('\n'),
              isSensitive: true,
            };
          }
          return {
            handled: true,
            text: 'Không tìm thấy giáo viên phù hợp. Vui lòng kiểm tra lại tên giáo viên.',
            isSensitive: true,
          };
        }
      }
      queryResult = await queryAdminTeacherPayroll(
        db,
        {
          period: classification.period,
          teacher: resolvedTeacher,
          actor,
        },
        nowDate
      );
    } else if (classification.intent === 'admin_zalo_operations') {
      queryResult = await queryAdminZaloOperations(db, { period: classification.period }, nowDate);
    }

    if (!queryResult) {
      throw new Error('Admin intent has no deterministic executor');
    }

    await writeAudit('completed', {
      canonicalIds,
      classIds,
      period: classification.period ?? undefined,
      resultCount: 1,
    });

    formattedMessage = formatAdminQueryResult(queryResult, { isSensitiveViewer: true });

    return {
      handled: true,
      text: formattedMessage.text,
      isSensitive: formattedMessage.isSensitive,
    };
  } catch (err: unknown) {
    console.error('[AdminChatDispatcher] Query execution failed', {
      intent: classification.intent,
      errorType: err instanceof Error ? err.name : 'unknown_error',
    });
    try {
      await writeAudit('completed', { resultCount: 0 });
    } catch {
      // ignore
    }

    const safeErr = toSafeAdminError(err);
    return {
      handled: true,
      text: `⚠️ ${safeErr.safeMessage}`,
      isSensitive: false,
    };
  }
}
