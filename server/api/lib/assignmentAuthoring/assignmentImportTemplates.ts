import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { AUTHORING_IMPORT_COLUMNS } from '../../../../shared/assignmentAuthoring.js';

export type AuthoringImportTemplateFormat = 'xlsx' | 'csv' | 'docx';

export interface AuthoringImportTemplateFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

const EXAMPLE_ROWS = [
  {
    section: 'Listening',
    skill: 'listening',
    responseMode: 'multiple_choice',
    prompt: 'What does the speaker want?',
    instructions: 'Listen and choose the best answer.',
    optionA: 'A ticket',
    optionB: 'A book',
    optionC: '',
    optionD: '',
    correctAnswer: 'A',
    acceptedAnswers: '',
    points: '1',
    level: 'A2',
    mediaUrl: 'https://cdn.example.com/listening-1.mp3',
    mediaType: 'audio',
    transcript: '',
  },
  {
    section: 'Reading',
    skill: 'reading',
    responseMode: 'short_answer',
    prompt: 'Write the missing word.',
    instructions: 'Read and answer.',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    correctAnswer: '',
    acceptedAnswers: 'ticket; tickets',
    points: '2',
    level: 'A2',
    mediaUrl: '',
    mediaType: '',
    transcript: '',
  },
] as const;

export const AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT = [
  '# Section: Listening',
  'Skill: listening',
  'Instructions: Listen and choose the best answer.',
  '',
  'Q: What does the speaker want?',
  'Type: multiple_choice',
  'A. A ticket',
  'B. A book',
  'Answer: A',
  'Points: 1',
  'Level: A2',
  'Media: https://cdn.example.com/listening-1.mp3',
  'Media Type: audio',
  '---',
  'Q: Write the missing word.',
  'Type: short_answer',
  'Answer: ticket; tickets',
  'Points: 2',
  'Level: A2',
].join('\n');

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function buildXlsxTemplate(): Promise<AuthoringImportTemplateFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Assignment Import');
  sheet.addRow(AUTHORING_IMPORT_COLUMNS);
  EXAMPLE_ROWS.forEach((row) => {
    sheet.addRow(AUTHORING_IMPORT_COLUMNS.map((column) => row[column]));
  });
  sheet.getRow(1).font = { bold: true };
  sheet.columns = AUTHORING_IMPORT_COLUMNS.map((column) => ({
    header: column,
    key: column,
    width: Math.max(column.length + 4, 16),
  }));
  return {
    filename: 'assignment-import-template.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

function buildCsvTemplate(): AuthoringImportTemplateFile {
  const rows = [
    AUTHORING_IMPORT_COLUMNS,
    ...EXAMPLE_ROWS.map((row) => AUTHORING_IMPORT_COLUMNS.map((column) => row[column])),
  ];
  return {
    filename: 'assignment-import-template.csv',
    contentType: 'text/csv; charset=utf-8',
    buffer: Buffer.from(rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'utf8'),
  };
}

async function buildDocxTemplate(): Promise<AuthoringImportTemplateFile> {
  const document = new Document({
    sections: [
      {
        children: AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT.split('\n').map(
          (line) =>
            new Paragraph({
              children: [new TextRun(line || ' ')],
            })
        ),
      },
    ],
  });
  return {
    filename: 'assignment-import-template.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await Packer.toBuffer(document),
  };
}

export async function buildAuthoringImportTemplate(
  format: AuthoringImportTemplateFormat
): Promise<AuthoringImportTemplateFile> {
  if (format === 'xlsx') return buildXlsxTemplate();
  if (format === 'csv') return buildCsvTemplate();
  if (format === 'docx') return buildDocxTemplate();
  throw Object.assign(new Error('Unsupported import template format'), { statusCode: 400 });
}
