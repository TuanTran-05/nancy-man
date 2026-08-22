import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Readable } from 'stream';
import {
  validateAuthoringImportRows,
  type AuthoringImportEditableRow,
  type AuthoringImportIssue,
  type AuthoringImportPreview,
  type AuthoringImportSource,
} from '../../../../shared/assignmentAuthoring.js';

export const MAX_AUTHORING_IMPORT_QUESTIONS = 200;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type ParsedImportRow = Omit<AuthoringImportEditableRow, 'rowId'>;

export interface ParseAuthoringImportInput {
  buffer: Buffer;
  filename: string;
  mimetype?: string | null;
  unsafeAssumeDocxTextForTests?: boolean;
}

function withStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function display(value: unknown): string {
  if (value && typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return display((value as { result?: unknown }).result);
    if ('richText' in value && Array.isArray((value as { richText?: unknown }).richText)) {
      return (value as { richText: Array<{ text?: string }> }).richText
        .map((part) => part.text || '')
        .join('')
        .trim();
    }
  }
  return String(value ?? '').trim();
}

function hasZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  );
}

function sourceForFile(filename: string, mimetype?: string | null): AuthoringImportSource {
  const ext = getExt(filename);
  if (
    ext === 'xlsx' &&
    (!mimetype || mimetype === XLSX_MIME || mimetype === 'application/octet-stream')
  ) {
    return 'xlsx';
  }
  if (
    ext === 'csv' &&
    (!mimetype ||
      mimetype === 'text/csv' ||
      mimetype === 'application/vnd.ms-excel' ||
      mimetype === 'application/octet-stream')
  ) {
    return 'csv';
  }
  if (
    ext === 'docx' &&
    (!mimetype || mimetype === DOCX_MIME || mimetype === 'application/octet-stream')
  ) {
    return 'docx';
  }
  throw withStatus('Unsupported import file type', 400);
}

function editableRow(source: ParsedImportRow, index: number): AuthoringImportEditableRow {
  return {
    rowId: `row-${source.sourceRow ?? index + 1}`,
    ...source,
  };
}

function normalizeHeader(value: unknown): string {
  const normalized = normalizeText(value).replace(/[\s_-]+/g, '');
  const aliases: Record<string, string> = {
    section: 'section',
    sectiontitle: 'section',
    phan: 'section',
    skill: 'skill',
    kynang: 'skill',
    instructions: 'instructions',
    instruction: 'instructions',
    huongdan: 'instructions',
    responsemode: 'responseMode',
    type: 'responseMode',
    questiontype: 'responseMode',
    prompt: 'prompt',
    question: 'prompt',
    cauhoi: 'prompt',
    optiona: 'optionA',
    a: 'optionA',
    optionb: 'optionB',
    b: 'optionB',
    optionc: 'optionC',
    c: 'optionC',
    optiond: 'optionD',
    d: 'optionD',
    correctanswer: 'correctAnswer',
    answer: 'correctAnswer',
    dapan: 'correctAnswer',
    acceptedanswers: 'acceptedAnswers',
    points: 'points',
    diem: 'points',
    level: 'level',
    mediaurl: 'mediaUrl',
    media: 'mediaUrl',
    mediatype: 'mediaType',
    transcript: 'transcript',
  };
  return aliases[normalized] || normalized;
}

function rowFromObject(raw: Record<string, string>, sourceRow?: number): ParsedImportRow {
  return {
    sourceRow,
    section: raw.section || '',
    skill: raw.skill || '',
    instructions: raw.instructions || '',
    responseMode: raw.responseMode || '',
    prompt: raw.prompt || '',
    optionA: raw.optionA || '',
    optionB: raw.optionB || '',
    optionC: raw.optionC || '',
    optionD: raw.optionD || '',
    correctAnswer: raw.correctAnswer || '',
    acceptedAnswers: raw.acceptedAnswers || '',
    points: raw.points || '',
    level: raw.level || '',
    mediaUrl: raw.mediaUrl || '',
    mediaType: raw.mediaType || '',
    transcript: raw.transcript || '',
  };
}

async function rowsFromXlsx(buffer: Buffer): Promise<ParsedImportRow[]> {
  if (!hasZipSignature(buffer)) throw withStatus('Invalid .xlsx file', 400);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw withStatus('Workbook has no sheets', 400);
  const header: string[] = [];
  const rows: ParsedImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (worksheetRow, rowNumber) => {
    const values: string[] = [];
    for (let column = 1; column <= worksheetRow.cellCount; column += 1) {
      values.push(display(worksheetRow.getCell(column).value));
    }
    if (values.every((value) => !value.trim())) return;
    if (header.length === 0) {
      values.forEach((value, index) => {
        header[index] = normalizeHeader(value);
      });
      return;
    }
    const raw: Record<string, string> = {};
    values.forEach((value, index) => {
      if (header[index]) raw[header[index]] = value;
    });
    rows.push(rowFromObject(raw, rowNumber));
  });
  if (header.length === 0) throw withStatus('Workbook is empty', 400);
  return rows;
}

async function rowsFromCsv(buffer: Buffer): Promise<ParsedImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  const stream = Readable.from(buffer.toString('utf8'));
  const sheet = await workbook.csv.read(stream);
  const header: string[] = [];
  const rows: ParsedImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (worksheetRow, rowNumber) => {
    const values: string[] = [];
    for (let column = 1; column <= worksheetRow.cellCount; column += 1) {
      values.push(display(worksheetRow.getCell(column).value));
    }
    if (values.every((value) => !value.trim())) return;
    if (header.length === 0) {
      values.forEach((value, index) => {
        header[index] = normalizeHeader(value);
      });
      return;
    }
    const raw: Record<string, string> = {};
    values.forEach((value, index) => {
      if (header[index]) raw[header[index]] = value;
    });
    rows.push(rowFromObject(raw, rowNumber));
  });
  if (header.length === 0) throw withStatus('CSV file is empty', 400);
  return rows;
}

function rowsFromDocxText(text: string): {
  rows: ParsedImportRow[];
  issues: AuthoringImportIssue[];
} {
  const rows: ParsedImportRow[] = [];
  const issues: AuthoringImportIssue[] = [];
  let currentSection = '';
  let currentSkill = '';
  let currentInstructions = '';
  let current: Record<string, string> | null = null;

  const flush = () => {
    if (!current) return;
    rows.push(
      rowFromObject(
        {
          section: currentSection,
          skill: current.skill || currentSkill,
          instructions: currentInstructions,
          responseMode: current.responseMode || '',
          prompt: current.prompt || '',
          optionA: current.optionA || '',
          optionB: current.optionB || '',
          optionC: current.optionC || '',
          optionD: current.optionD || '',
          correctAnswer: current.correctAnswer || '',
          acceptedAnswers: current.acceptedAnswers || '',
          points: current.points || '',
          level: current.level || '',
          mediaUrl: current.mediaUrl || '',
          mediaType: current.mediaType || '',
          transcript: current.transcript || '',
        },
        rows.length + 1
      )
    );
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^#\s*Section:\s*(.+)$/i);
    if (sectionMatch) {
      flush();
      currentSection = sectionMatch[1].trim();
      currentSkill = '';
      currentInstructions = '';
      continue;
    }
    const questionMatch = line.match(/^Q:\s*(.+)$/i);
    if (questionMatch) {
      flush();
      current = { prompt: questionMatch[1].trim() };
      continue;
    }
    const pairMatch = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (pairMatch) {
      const key = normalizeHeader(pairMatch[1]);
      const value = pairMatch[2].trim();
      if (key === 'skill' && !current) {
        currentSkill = value;
      } else if (key === 'instructions' && !current) {
        currentInstructions = value;
      } else if (current) {
        current[key] = value;
      } else {
        issues.push({
          severity: 'warning',
          code: 'ignored_text',
          message: `Ignored text outside a question: ${line}`,
        });
      }
      continue;
    }
    const optionMatch = line.match(/^([A-D])\.\s*(.+)$/i);
    if (optionMatch && current) {
      current[`option${optionMatch[1].toUpperCase()}`] = optionMatch[2].trim();
      continue;
    }
    if (line === '---') {
      flush();
      continue;
    }
    issues.push({
      severity: 'warning',
      code: 'ignored_text',
      message: `Ignored text: ${line}`,
    });
  }
  flush();
  return { rows, issues };
}

async function rowsFromDocx(
  input: ParseAuthoringImportInput
): Promise<{ rows: ParsedImportRow[]; issues: AuthoringImportIssue[] }> {
  if (!input.unsafeAssumeDocxTextForTests && !hasZipSignature(input.buffer)) {
    throw withStatus('Invalid .docx file', 400);
  }
  const text = input.unsafeAssumeDocxTextForTests
    ? input.buffer.toString('utf8')
    : (await mammoth.extractRawText({ buffer: input.buffer })).value;
  return rowsFromDocxText(text);
}

export async function parseAuthoringImportBuffer(
  input: ParseAuthoringImportInput
): Promise<AuthoringImportPreview> {
  const source = sourceForFile(input.filename, input.mimetype);
  let rows: ParsedImportRow[] = [];
  let docxIssues: AuthoringImportIssue[] = [];

  if (source === 'xlsx') rows = await rowsFromXlsx(input.buffer);
  if (source === 'csv') rows = await rowsFromCsv(input.buffer);
  if (source === 'docx') {
    const parsed = await rowsFromDocx(input);
    rows = parsed.rows;
    docxIssues = parsed.issues;
  }

  if (rows.length > MAX_AUTHORING_IMPORT_QUESTIONS) {
    throw withStatus(`Cannot import more than ${MAX_AUTHORING_IMPORT_QUESTIONS} questions`, 400);
  }

  return validateAuthoringImportRows({
    source,
    filename: input.filename,
    rows: rows.map(editableRow),
    extraIssues: docxIssues,
  });
}
