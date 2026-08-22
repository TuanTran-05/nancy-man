import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { patchDetector } from 'docx';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';
import { renderCourseClosingDocument } from './courseClosingRecordDocuments.js';

const evaluationTemplate = new URL(
  './templates/course-closing-evaluation-v1.docx',
  import.meta.url
);
const tuitionTemplate = new URL('./templates/course-closing-tuition-v1.docx', import.meta.url);

const makeReadyRecord = (): CourseClosingRecord => ({
  id: 'course-1__student-1',
  recordVersion: 1,
  closingMonth: '2026-07',
  courseId: 'course-1',
  classId: 'class-1',
  className: 'IELTS 6.0',
  classNameNormalized: 'ielts 6.0',
  courseStartDate: '2026-03-18',
  courseEndDate: '2026-07-18',
  studentId: 'student-1',
  studentName: 'Nguyễn Văn An',
  studentNameNormalized: 'nguyen van an',
  studentCode: 'HV001',
  teacherId: 'teacher-1',
  teacherName: 'Trần Minh',
  evaluationSnapshot: {
    evaluationId: 'eval-final',
    evaluationVersion: '2026-07-18T10:00:00.000Z',
    evaluationDate: '2026-07-18',
    scores: {
      attendance: 95,
      effort: 80,
      pronunciation: 82,
      homework: 78,
      behavior: 90,
    },
    finalExamScore: 88,
    totalScore: 84,
    classification: 'good',
    positivePoints: ['Phát âm tốt'],
    improvementPoints: 'Cần tăng tốc độ phản xạ',
    midterm: {
      evaluationId: 'eval-mid',
      evaluationDate: '2026-06-18',
      examScore: 76,
    },
  },
  tuitionSnapshot: {
    noticeDate: '2026-07-18',
    amount: 2400000,
    paymentWindowStart: '2026-07-18',
    paymentDueDate: '2026-08-01',
    previousCourseStartDate: '2026-03-18',
    previousCourseEndDate: '2026-07-18',
    finalExamDate: '2026-07-18',
    finalExamScore: 88,
    nextCourseStartDate: '2026-08-01',
    nextCourseEndDate: '2026-11-21',
    ledgerId: 'ledger-1',
  },
  evaluationDocument: {
    type: 'evaluation',
    status: 'pending',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  },
  tuitionDocument: {
    type: 'tuition',
    status: 'pending',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  },
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
});

async function expectEveryXmlPartToBeWellFormed(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xmlParts = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.endsWith('.xml')
  );

  expect(xmlParts.length).toBeGreaterThan(0);

  const { DOMParser } = new JSDOM().window;
  const parser = new DOMParser();
  for (const part of xmlParts) {
    const xml = await part.async('string');
    const document = parser.parseFromString(xml, 'application/xml');
    const parseError = document.querySelector('parsererror');
    expect(parseError?.textContent, `${part.name} must contain well-formed XML`).toBeUndefined();
  }
}

async function expectIgnorableNamespacePrefixesToBeDeclared(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toBeDefined();

  const root = documentXml?.match(/<w:document\b[^>]*>/)?.[0];
  expect(root).toBeDefined();

  const declaredPrefixes = new Set(
    Array.from(root?.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)="[^"]+"/g) || [], (match) => match[1])
  );
  const ignorablePrefixes = Array.from(
    root?.matchAll(/\s[A-Za-z_][\w.-]*:Ignorable="([^"]*)"/g) || [],
    (match) => match[1].split(/\s+/).filter(Boolean)
  ).flat();

  expect(ignorablePrefixes.length).toBeGreaterThan(0);
  expect(ignorablePrefixes.filter((prefix) => !declaredPrefixes.has(prefix))).toEqual([]);
}

async function expectTableCellRunsToBeWrappedInParagraphs(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toBeDefined();

  const { DOMParser } = new JSDOM().window;
  const document = new DOMParser().parseFromString(documentXml || '', 'application/xml');
  const wordprocessingNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const tableCells = Array.from(
    document.getElementsByTagNameNS(wordprocessingNamespace, 'tc') as unknown as ArrayLike<Element>
  );
  const invalidRuns = tableCells.flatMap((cell) =>
    Array.from(cell.childNodes).filter((child) => {
      const element = child as Element;
      return (
        element.nodeType === element.ELEMENT_NODE &&
        element.namespaceURI === wordprocessingNamespace &&
        element.localName === 'r'
      );
    })
  );

  expect(invalidRuns.length, 'table-cell runs must be wrapped in w:p paragraphs').toBe(0);
}

async function packagePartHashes(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const preservedParts = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      (entry.name.startsWith('word/media/') ||
        entry.name === 'word/styles.xml' ||
        entry.name === 'word/fontTable.xml' ||
        entry.name === 'word/theme/theme1.xml')
  );
  return Object.fromEntries(
    await Promise.all(
      preservedParts.map(async (entry) => [
        entry.name,
        createHash('sha256')
          .update(await entry.async('nodebuffer'))
          .digest('hex'),
      ])
    )
  );
}

async function expectTemplatePartsPreserved(template: URL, output: Buffer) {
  expect(await packagePartHashes(output)).toEqual(
    await packagePartHashes(await readFile(template))
  );
}

describe('courseClosingRecordDocuments', () => {
  it('renders the evaluation template without unresolved placeholders', async () => {
    const buffer = await renderCourseClosingDocument(makeReadyRecord(), 'evaluation');
    expect(await patchDetector({ data: buffer })).toEqual([]);
    await expectEveryXmlPartToBeWellFormed(buffer);
    await expectIgnorableNamespacePrefixesToBeDeclared(buffer);
    await expectTableCellRunsToBeWrappedInParagraphs(buffer);
    const text = (await mammoth.extractRawText({ buffer })).value;
    expect(text).toContain('Nguyễn Văn An');
    expect(text).toContain('IELTS 6.0');
    expect(text).toContain('Phát âm tốt');
    expect(text).toContain('Good (Giỏi)');
  });

  it('renders the tuition template with the exact sent amount and dates', async () => {
    const buffer = await renderCourseClosingDocument(makeReadyRecord(), 'tuition');
    expect(await patchDetector({ data: buffer })).toEqual([]);
    await expectEveryXmlPartToBeWellFormed(buffer);
    await expectIgnorableNamespacePrefixesToBeDeclared(buffer);
    await expectTableCellRunsToBeWrappedInParagraphs(buffer);
    const text = (await mammoth.extractRawText({ buffer })).value;
    expect(text).toContain('2.400.000');
    expect(text).toContain('18/07/2026');
    expect(text).toContain('01/08/2026');
  });

  it('renders unavailable evaluation data without numeric zero fallbacks', async () => {
    const record = makeReadyRecord();
    delete record.evaluationSnapshot;
    record.evaluationDataAvailability = {
      status: 'unavailable',
      reason: 'historical_source_missing',
      assessedAt: '2026-07-27T00:00:00.000Z',
    };

    const buffer = await renderCourseClosingDocument(record, 'evaluation');
    expect(await patchDetector({ data: buffer })).toEqual([]);
    await expectEveryXmlPartToBeWellFormed(buffer);
    await expectTemplatePartsPreserved(evaluationTemplate, buffer);
    const text = (await mammoth.extractRawText({ buffer })).value;
    expect(text).toContain('Chưa có dữ liệu');
    expect(text).not.toMatch(/Điểm thi cuối khóa[^\r\n]*\b0\b/i);
  });

  it('renders unavailable tuition data without inventing amount or due date', async () => {
    const record = makeReadyRecord();
    delete record.tuitionSnapshot;
    record.tuitionDataAvailability = {
      status: 'unavailable',
      reason: 'historical_source_incomplete',
      assessedAt: '2026-07-27T00:00:00.000Z',
    };

    const buffer = await renderCourseClosingDocument(record, 'tuition');
    expect(await patchDetector({ data: buffer })).toEqual([]);
    await expectEveryXmlPartToBeWellFormed(buffer);
    await expectTemplatePartsPreserved(tuitionTemplate, buffer);
    const text = (await mammoth.extractRawText({ buffer })).value;
    expect(text).toContain('Chưa có dữ liệu kết quả thi cuối khóa');
    expect(text).toContain('Chưa có dữ liệu học phí cho khóa tiếp theo');
    expect(text).not.toContain('0 VNĐ');
  });

  it('refuses a missing snapshot that was not explicitly assessed unavailable', async () => {
    const record = makeReadyRecord();
    delete record.evaluationSnapshot;

    await expect(renderCourseClosingDocument(record, 'evaluation')).rejects.toThrow(
      'Missing evaluationSnapshot in course closing record'
    );
  });
});
