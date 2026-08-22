import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT,
  buildAuthoringImportTemplate,
} from './assignmentImportTemplates.js';
import { AUTHORING_IMPORT_COLUMNS } from '../../../../shared/assignmentAuthoring.js';

describe('assignment authoring import templates', () => {
  it('builds an xlsx template with canonical headers and examples', async () => {
    const template = await buildAuthoringImportTemplate('xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.buffer);
    const sheet = workbook.worksheets[0];

    expect(template.filename).toBe('assignment-import-template.xlsx');
    expect(template.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(sheet.getRow(1).values).toEqual([undefined, ...AUTHORING_IMPORT_COLUMNS]);
    expect(sheet.getRow(2).getCell(3).value).toBe('multiple_choice');
    expect(sheet.getRow(3).getCell(3).value).toBe('short_answer');
  });

  it('builds a csv template with canonical headers and examples', async () => {
    const template = await buildAuthoringImportTemplate('csv');
    const text = template.buffer.toString('utf8');

    expect(template.filename).toBe('assignment-import-template.csv');
    expect(template.contentType).toBe('text/csv; charset=utf-8');
    expect(text.split('\n')[0]).toBe(AUTHORING_IMPORT_COLUMNS.join(','));
    expect(text).toContain('Listening,listening,multiple_choice');
    expect(text).toContain('Reading,reading,short_answer');
  });

  it('builds a docx template with strict template markers', async () => {
    const template = await buildAuthoringImportTemplate('docx');

    expect(template.filename).toBe('assignment-import-template.docx');
    expect(template.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(template.buffer.length).toBeGreaterThan(100);
    expect(AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT).toContain('# Section: Listening');
    expect(AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT).toContain('Type: multiple_choice');
    expect(AUTHORING_IMPORT_TEMPLATE_DOCX_TEXT).toContain('Type: short_answer');
  });

  it('rejects unsupported template formats', async () => {
    await expect(buildAuthoringImportTemplate('pdf' as any)).rejects.toThrow(
      'Unsupported import template format'
    );
  });
});
