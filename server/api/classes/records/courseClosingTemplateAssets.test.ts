import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { patchDetector } from 'docx';

const sourceEvaluation = new URL(
  '../../../../docs/assets/course-closing-templates/Nhan-Xet-Ket-Khoa-source-v1.docx',
  import.meta.url
);
const sourceTuition = new URL(
  '../../../../docs/assets/course-closing-templates/Thong-Bao-HP-source-v1.docx',
  import.meta.url
);
const preparedEvaluation = new URL(
  './templates/course-closing-evaluation-v1.docx',
  import.meta.url
);
const preparedTuition = new URL('./templates/course-closing-tuition-v1.docx', import.meta.url);

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex').toUpperCase();

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

  expect(ignorablePrefixes.filter((prefix) => !declaredPrefixes.has(prefix))).toEqual([]);
}

describe('course closing template assets', () => {
  it('retains the approved source files byte-for-byte', async () => {
    expect(sha256(await readFile(sourceEvaluation))).toBe(
      'A1F45565B879BB00609BB06E89EEEE97E4B289B30A40917C02E520E0F1A2AF19'
    );
    expect(sha256(await readFile(sourceTuition))).toBe(
      '0BB08A44AD6FC1592953410559714D75A50A2DB164179DEAB28347B8CF1B39BF'
    );
  });

  it('contains the exact evaluation placeholder inventory', async () => {
    expect([...(await patchDetector({ data: await readFile(preparedEvaluation) }))].sort()).toEqual(
      [
        'attendance_score',
        'behavior_score',
        'class_name',
        'classification',
        'effort_score',
        'final_date',
        'final_score',
        'homework_score',
        'midterm_date',
        'midterm_score',
        'pronunciation_score',
        'student_name',
        'teacher_comments',
        'teacher_name',
        'total_score',
      ].sort()
    );
  });

  it('contains the exact tuition paragraph placeholder inventory', async () => {
    expect([...(await patchDetector({ data: await readFile(preparedTuition) }))].sort()).toEqual(
      [
        'tuition_course_period',
        'tuition_exam_result',
        'tuition_greeting',
        'tuition_next_course',
        'tuition_notice_date',
      ].sort()
    );
  });

  it('keeps every markup-compatibility prefix declared in prepared templates', async () => {
    await expectIgnorableNamespacePrefixesToBeDeclared(await readFile(preparedEvaluation));
    await expectIgnorableNamespacePrefixesToBeDeclared(await readFile(preparedTuition));
  });
});
