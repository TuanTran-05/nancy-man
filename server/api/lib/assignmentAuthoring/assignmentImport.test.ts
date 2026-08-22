import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { MAX_AUTHORING_IMPORT_QUESTIONS, parseAuthoringImportBuffer } from './assignmentImport.js';

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('assignment authoring import parser', () => {
  it('parses a valid xlsx multiple-choice row', async () => {
    const buffer = await workbookBuffer([
      [
        'section',
        'skill',
        'responseMode',
        'prompt',
        'optionA',
        'optionB',
        'correctAnswer',
        'points',
        'level',
        'mediaUrl',
        'mediaType',
      ],
      [
        'Listening',
        'listening',
        'multiple_choice',
        'What does the speaker want?',
        'A ticket',
        'A book',
        'A',
        1,
        'A2',
        'https://cdn.example.com/audio.mp3',
        'audio',
      ],
    ]);

    const preview = await parseAuthoringImportBuffer({
      buffer,
      filename: 'unit.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(preview).toMatchObject({
      source: 'xlsx',
      totalQuestions: 1,
      validQuestions: 1,
      warningCount: 0,
      errorCount: 0,
      sections: [
        {
          title: 'Listening',
          skill: 'listening',
          questions: [
            {
              prompt: 'What does the speaker want?',
              responseMode: 'multiple_choice',
              correctAnswer: 'A',
              options: [
                { key: 'A', text: 'A ticket' },
                { key: 'B', text: 'A book' },
              ],
              media: [
                {
                  type: 'audio',
                  source: 'external_url',
                  url: 'https://cdn.example.com/audio.mp3',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(preview.editableRows).toEqual([
      expect.objectContaining({
        rowId: 'row-2',
        sourceRow: 2,
        section: 'Listening',
        skill: 'listening',
        responseMode: 'multiple_choice',
        prompt: 'What does the speaker want?',
        optionA: 'A ticket',
        optionB: 'A book',
        correctAnswer: 'A',
        mediaUrl: 'https://cdn.example.com/audio.mp3',
        mediaType: 'audio',
      }),
    ]);
  });

  it('parses csv short-answer accepted answers', async () => {
    const csv = [
      'section,skill,responseMode,prompt,acceptedAnswers,points,level',
      'Reading,reading,short_answer,Write the missing word.,ticket; tickets,2,A2',
    ].join('\n');

    const preview = await parseAuthoringImportBuffer({
      buffer: Buffer.from(csv, 'utf8'),
      filename: 'unit.csv',
      mimetype: 'text/csv',
    });

    expect(preview.validQuestions).toBe(1);
    expect(preview.sections[0].questions[0]).toMatchObject({
      responseMode: 'short_answer',
      acceptedAnswers: ['ticket', 'tickets'],
      gradingMode: 'manual',
      points: 2,
    });
  });

  it('keeps valid rows and reports invalid multiple-choice rows as errors', async () => {
    const buffer = await workbookBuffer([
      ['section', 'skill', 'responseMode', 'prompt', 'optionA', 'correctAnswer'],
      ['Listening', 'listening', 'multiple_choice', 'Broken question', 'Only one option', 'B'],
      ['Listening', 'listening', 'short_answer', 'Valid question', '', 'answer'],
    ]);

    const preview = await parseAuthoringImportBuffer({
      buffer,
      filename: 'unit.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(preview.totalQuestions).toBe(2);
    expect(preview.validQuestions).toBe(1);
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(preview.sections[0].questions.map((question) => question.prompt)).toEqual([
      'Valid question',
    ]);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'multiple_choice_options_required',
          row: 2,
        }),
      ])
    );
  });

  it('returns editable rows for invalid xlsx rows', async () => {
    const buffer = await workbookBuffer([
      ['section', 'skill', 'responseMode', 'prompt', 'optionA', 'correctAnswer'],
      ['Listening', 'listening', 'multiple_choice', 'Broken question', 'Only one option', 'B'],
    ]);

    const preview = await parseAuthoringImportBuffer({
      buffer,
      filename: 'unit.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(preview.validQuestions).toBe(0);
    expect(preview.editableRows).toEqual([
      expect.objectContaining({
        rowId: 'row-2',
        sourceRow: 2,
        section: 'Listening',
        responseMode: 'multiple_choice',
        prompt: 'Broken question',
        optionA: 'Only one option',
        correctAnswer: 'B',
      }),
    ]);
  });

  it('rejects rows with a missing response mode', async () => {
    const csv = [
      'section,skill,responseMode,prompt,optionA,optionB,correctAnswer',
      'Listening,listening,,Question,A,B,A',
    ].join('\n');

    const preview = await parseAuthoringImportBuffer({
      buffer: Buffer.from(csv, 'utf8'),
      filename: 'unit.csv',
      mimetype: 'text/csv',
    });

    expect(preview.validQuestions).toBe(0);
    expect(preview.sections).toEqual([]);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_response_mode',
        row: 2,
        field: 'responseMode',
      })
    );
  });

  it('parses strict docx template text', async () => {
    const preview = await parseAuthoringImportBuffer({
      buffer: Buffer.from(
        [
          '# Section: Listening',
          'Skill: listening',
          'Instructions: Listen and choose.',
          '',
          'Q: What does the speaker want?',
          'Type: multiple_choice',
          'A. A ticket',
          'B. A book',
          'Answer: B',
          'Points: 1',
          'Level: A2',
          '---',
          'Q: Write the word.',
          'Type: short_answer',
          'Answer: ticket; tickets',
          'Points: 2',
        ].join('\n'),
        'utf8'
      ),
      filename: 'unit.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      unsafeAssumeDocxTextForTests: true,
    });

    expect(preview.source).toBe('docx');
    expect(preview.validQuestions).toBe(2);
    expect(preview.sections[0]).toMatchObject({
      title: 'Listening',
      skill: 'listening',
      instructions: 'Listen and choose.',
    });
    expect(preview.editableRows).toEqual([
      expect.objectContaining({
        rowId: 'row-1',
        sourceRow: 1,
        section: 'Listening',
        skill: 'listening',
        responseMode: 'multiple_choice',
        optionA: 'A ticket',
        optionB: 'A book',
      }),
      expect.objectContaining({
        rowId: 'row-2',
        sourceRow: 2,
        section: 'Listening',
        skill: 'listening',
        responseMode: 'short_answer',
        correctAnswer: 'ticket; tickets',
      }),
    ]);
  });

  it('rejects non-https media urls', async () => {
    const csv = [
      'section,skill,responseMode,prompt,optionA,optionB,correctAnswer,mediaUrl,mediaType',
      'Listening,listening,multiple_choice,Question,A,B,A,http://example.com/a.mp3,audio',
    ].join('\n');

    const preview = await parseAuthoringImportBuffer({
      buffer: Buffer.from(csv, 'utf8'),
      filename: 'unit.csv',
      mimetype: 'text/csv',
    });

    expect(preview.validQuestions).toBe(0);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'external_media_https_required',
      })
    );
  });

  it('rejects unsupported file types', async () => {
    await expect(
      parseAuthoringImportBuffer({
        buffer: Buffer.from('plain text'),
        filename: 'unit.txt',
        mimetype: 'text/plain',
      })
    ).rejects.toThrow('Unsupported import file type');
  });

  it('rejects files with too many questions', async () => {
    const rows = [['section', 'skill', 'responseMode', 'prompt', 'acceptedAnswers']];
    for (let i = 0; i < MAX_AUTHORING_IMPORT_QUESTIONS + 1; i += 1) {
      rows.push(['Reading', 'reading', 'short_answer', `Question ${i + 1}`, 'answer']);
    }
    const buffer = await workbookBuffer(rows);

    await expect(
      parseAuthoringImportBuffer({
        buffer,
        filename: 'large.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    ).rejects.toThrow(`Cannot import more than ${MAX_AUTHORING_IMPORT_QUESTIONS} questions`);
  });
});
