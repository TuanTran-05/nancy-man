import { readFile } from 'node:fs/promises';
import { patchDocument, patchDetector, PatchType, TextRun } from 'docx';
import JSZip from 'jszip';
import { deriveCourseClosingDataAvailability } from '../../../../shared/courseClosingRecords.js';
import type {
  ClosingDocumentType,
  CourseClosingRecord,
  CourseResultClassification,
} from '../../../../shared/courseClosingRecords.js';

function formatDisplayDate(dateOnlyStr?: string): string {
  if (!dateOnlyStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnlyStr)) return '';
  const [y, m, d] = dateOnlyStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatVnCurrency(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function getClassificationLabel(classification: CourseResultClassification): string {
  switch (classification) {
    case 'excellent':
      return 'Excellent (Xuất sắc)';
    case 'good':
      return 'Good (Giỏi)';
    case 'fair':
      return 'Fair (Khá)';
    case 'average':
      return 'Average (Trung bình)';
    case 'failing':
      return 'Failing (Cần cố gắng)';
    default:
      return String(classification);
  }
}

const MARKUP_COMPATIBILITY_NAMESPACE =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';
const TEMPLATE_URLS = {
  evaluation: new URL('./templates/course-closing-evaluation-v1.docx', import.meta.url),
  tuition: new URL('./templates/course-closing-tuition-v1.docx', import.meta.url),
} as const;

async function normalizeMarkupCompatibilityAttributes(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) {
    throw new Error('COURSE_CLOSING_TEMPLATE_DOCUMENT_XML_MISSING');
  }

  const xml = await documentPart.async('string');
  const rootStart = xml.match(/<w:document\b[^>]*>/)?.[0];
  if (!rootStart) {
    throw new Error('COURSE_CLOSING_TEMPLATE_DOCUMENT_ROOT_MISSING');
  }

  const compatibilityPrefixes = Array.from(
    rootStart.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)="([^"]+)"/g)
  )
    .filter((match) => match[2] === MARKUP_COMPATIBILITY_NAMESPACE)
    .map((match) => match[1]);

  if (compatibilityPrefixes.length === 0) {
    return buffer;
  }

  const escapedPrefixes = compatibilityPrefixes.map((prefix) =>
    prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const ignorablePattern = new RegExp(
    `\\s+(?:${escapedPrefixes.join('|')}):Ignorable="([^"]*)"`,
    'g'
  );
  const ignorableValues = Array.from(rootStart.matchAll(ignorablePattern));
  if (ignorableValues.length === 0) {
    return buffer;
  }

  const declaredPrefixes = new Set(
    Array.from(rootStart.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)="[^"]+"/g), (match) => match[1])
  );
  const mergedValue = Array.from(
    new Set(ignorableValues.flatMap((match) => match[1].split(/\s+/).filter(Boolean)))
  )
    .filter((prefix) => declaredPrefixes.has(prefix))
    .join(' ');
  const preferredPrefix = compatibilityPrefixes.includes('mc') ? 'mc' : compatibilityPrefixes[0];
  const rootWithoutIgnorable = rootStart.replace(ignorablePattern, '');
  const normalizedRoot = mergedValue
    ? rootWithoutIgnorable.replace(/>$/, ` ${preferredPrefix}:Ignorable="${mergedValue}">`)
    : rootWithoutIgnorable;

  zip.file('word/document.xml', xml.replace(rootStart, normalizedRoot));
  return await zip.generateAsync({ type: 'nodebuffer' });
}

export async function renderCourseClosingDocument(
  record: CourseClosingRecord,
  documentType: ClosingDocumentType
): Promise<Buffer> {
  const template = await readFile(TEMPLATE_URLS[documentType]);

  const patches: Record<string, any> = {};

  if (documentType === 'evaluation') {
    const evalSnap = record.evaluationSnapshot;
    if (!evalSnap) {
      if (
        deriveCourseClosingDataAvailability(
          record.evaluationSnapshot,
          record.evaluationDataAvailability
        ) !== 'unavailable'
      ) {
        throw new Error('Missing evaluationSnapshot in course closing record');
      }

      const unavailable = 'Chưa có dữ liệu';
      patches.student_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.studentName })],
      };
      patches.class_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.className })],
      };
      for (const slot of [
        'attendance_score',
        'effort_score',
        'midterm_date',
        'midterm_score',
        'pronunciation_score',
        'final_date',
        'final_score',
        'homework_score',
        'total_score',
        'behavior_score',
        'classification',
      ]) {
        patches[slot] = {
          type: PatchType.PARAGRAPH,
          children: [new TextRun({ text: unavailable })],
        };
      }
      patches.teacher_comments = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: 'Chưa có dữ liệu đánh giá cuối khóa được ghi nhận trong nguồn lịch sử.',
          }),
        ],
      };
      patches.teacher_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.teacherName })],
      };
    } else {
      const posText =
        evalSnap.positivePoints.length > 0
          ? evalSnap.positivePoints.join(', ')
          : 'Chưa có ghi nhận đặc biệt';
      const impText = evalSnap.improvementPoints || 'Chưa có ghi nhận đặc biệt';

      patches.student_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.studentName })],
      };
      patches.class_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.className })],
      };
      patches.attendance_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.scores.attendance) })],
      };
      patches.effort_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.scores.effort) })],
      };
      patches.midterm_date = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: evalSnap.midterm ? formatDisplayDate(evalSnap.midterm.evaluationDate) : '',
          }),
        ],
      };
      patches.midterm_score = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: evalSnap.midterm ? String(evalSnap.midterm.examScore) : '',
          }),
        ],
      };
      patches.pronunciation_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.scores.pronunciation) })],
      };
      patches.final_date = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: formatDisplayDate(evalSnap.evaluationDate) })],
      };
      patches.final_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.finalExamScore) })],
      };
      patches.homework_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.scores.homework) })],
      };
      patches.total_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.totalScore) })],
      };
      patches.behavior_score = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(evalSnap.scores.behavior) })],
      };
      patches.classification = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: getClassificationLabel(evalSnap.classification) })],
      };
      patches.teacher_comments = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({ text: 'Điểm tốt: ', bold: true }),
          new TextRun({ text: posText }),
          new TextRun({ text: '', break: 1 }),
          new TextRun({ text: 'Cần cải thiện: ', bold: true }),
          new TextRun({ text: impText }),
        ],
      };
      patches.teacher_name = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: record.teacherName })],
      };
    }
  } else {
    const tuitionSnap = record.tuitionSnapshot;
    if (!tuitionSnap) {
      if (
        deriveCourseClosingDataAvailability(
          record.tuitionSnapshot,
          record.tuitionDataAvailability
        ) !== 'unavailable'
      ) {
        throw new Error('Missing tuitionSnapshot in course closing record');
      }

      patches.tuition_greeting = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({ text: 'Kính gửi Phụ huynh học sinh ' }),
          new TextRun({ text: record.studentName, bold: true }),
          new TextRun({ text: ' (Lớp ' }),
          new TextRun({ text: record.className, bold: true }),
          new TextRun({ text: '), ' }),
        ],
      };
      patches.tuition_course_period = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: `Khóa học từ ${formatDisplayDate(record.courseStartDate)} đến ${formatDisplayDate(record.courseEndDate)} đã kết thúc.`,
          }),
        ],
      };
      patches.tuition_exam_result = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: 'Chưa có dữ liệu kết quả thi cuối khóa.' })],
      };
      patches.tuition_next_course = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: 'Chưa có dữ liệu học phí cho khóa tiếp theo.' })],
      };
      patches.tuition_notice_date = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: 'Dữ liệu thông báo học phí lịch sử chưa được ghi nhận đầy đủ.',
            italics: true,
          }),
        ],
      };
    } else {
      const prevStart = formatDisplayDate(tuitionSnap.previousCourseStartDate);
      const prevEnd = formatDisplayDate(tuitionSnap.previousCourseEndDate);
      const nextStart = formatDisplayDate(tuitionSnap.nextCourseStartDate);
      const nextEnd = formatDisplayDate(tuitionSnap.nextCourseEndDate);
      const dueDate = formatDisplayDate(tuitionSnap.paymentDueDate);
      const amountStr = formatVnCurrency(tuitionSnap.amount);

      const [noticeYear, noticeMonth, noticeDay] = tuitionSnap.noticeDate.split('-');

      patches.tuition_greeting = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({ text: 'Kính gửi Phụ huynh học sinh ' }),
          new TextRun({ text: record.studentName, bold: true }),
          new TextRun({ text: ' (Lớp ' }),
          new TextRun({ text: record.className, bold: true }),
          new TextRun({ text: '), ' }),
        ],
      };
      patches.tuition_course_period = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: `Khóa học từ ${prevStart} đến ${prevEnd} đã kết thúc.` })],
      };
      patches.tuition_exam_result = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            // Backfilled records may carry a snapshot without a final exam score.
            text:
              tuitionSnap.finalExamScore === undefined
                ? 'Chưa có dữ liệu kết quả thi cuối khóa.'
                : `Kết quả thi cuối khóa của học sinh đạt ${tuitionSnap.finalExamScore} điểm.`,
          }),
        ],
      };
      patches.tuition_next_course = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: `Khóa học tiếp theo sẽ bắt đầu từ ${nextStart} đến ${nextEnd}. Học phí cần thanh toán là ${amountStr} VNĐ trước ngày ${dueDate}.`,
          }),
        ],
      };
      patches.tuition_notice_date = {
        type: PatchType.PARAGRAPH,
        children: [
          new TextRun({
            text: `Hà Nội, ngày ${noticeDay} tháng ${noticeMonth} năm ${noticeYear}`,
            italics: true,
          }),
        ],
      };
    }
  }

  const patchedBuffer = await patchDocument({
    outputType: 'nodebuffer',
    data: template,
    keepOriginalStyles: true,
    recursive: true,
    patches,
  });

  const normalizedBuffer = await normalizeMarkupCompatibilityAttributes(patchedBuffer as Buffer);
  const remainingPlaceholders = await patchDetector({ data: normalizedBuffer });
  if (remainingPlaceholders.length > 0) {
    throw new Error(`COURSE_CLOSING_TEMPLATE_SLOT_UNRESOLVED: ${remainingPlaceholders.join(', ')}`);
  }

  return normalizedBuffer;
}
