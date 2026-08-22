import { describe, expect, it } from 'vitest';
import {
  FILE_TYPE_ERROR,
  PRINT_REQUEST_ALLOWED_EXTENSIONS,
  canTransitionPrintRequestStatus,
  getPrintRequestDateKey,
  getPrintRequestFileType,
  normalizePrintRequestDateKey,
  normalizePrintQuantity,
  validatePrintRequestFile,
} from './printRequests';

describe('print request helpers', () => {
  it('creates stable local date keys from ISO strings', () => {
    expect(getPrintRequestDateKey('2026-06-10T08:30:00.000Z')).toBe('2026-06-10');
    expect(getPrintRequestDateKey('')).toBe('');
    expect(getPrintRequestDateKey('not-a-date')).toBe('');
  });

  it('prefers an explicit date key when the UI sends local date context', () => {
    expect(normalizePrintRequestDateKey('2026-06-10', '2026-06-09T18:30:00.000Z')).toBe(
      '2026-06-10'
    );
    expect(normalizePrintRequestDateKey('', '2026-06-10T08:30:00.000Z')).toBe('2026-06-10');
    expect(normalizePrintRequestDateKey('2026-13-10', '2026-06-10T08:30:00.000Z')).toBe('');
  });

  it('normalizes positive integer quantities', () => {
    expect(normalizePrintQuantity('20')).toBe(20);
    expect(normalizePrintQuantity(3)).toBe(3);
    expect(normalizePrintQuantity('0')).toBe(null);
    expect(normalizePrintQuantity('1.5')).toBe(null);
    expect(normalizePrintQuantity('abc')).toBe(null);
  });

  it('allows the approved office file extensions', () => {
    expect(PRINT_REQUEST_ALLOWED_EXTENSIONS).toEqual([
      'pdf',
      'doc',
      'docx',
      'ppt',
      'pptx',
      'xls',
      'xlsx',
      'jpg',
      'jpeg',
      'png',
    ]);
    expect(getPrintRequestFileType('worksheet.PDF')).toBe('pdf');
    expect(getPrintRequestFileType('slides.pptx')).toBe('pptx');
    expect(getPrintRequestFileType('image.jpeg')).toBe('jpeg');
  });

  it('validates file extension and MIME pairs', () => {
    expect(validatePrintRequestFile('worksheet.pdf', 'application/pdf')).toEqual({
      fileType: 'pdf',
      mimeType: 'application/pdf',
    });
    expect(
      validatePrintRequestFile(
        'slides.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ).toEqual({
      fileType: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    expect(validatePrintRequestFile('bad.exe', 'application/octet-stream')).toEqual({
      error: FILE_TYPE_ERROR,
    });
    expect(validatePrintRequestFile('worksheet.pdf', 'image/png')).toEqual({
      error: FILE_TYPE_ERROR,
    });
  });

  it('enforces allowed status transitions', () => {
    expect(canTransitionPrintRequestStatus('pending', 'printed')).toBe(true);
    expect(canTransitionPrintRequestStatus('printed', 'completed')).toBe(true);
    expect(canTransitionPrintRequestStatus('pending', 'rejected')).toBe(true);
    expect(canTransitionPrintRequestStatus('pending', 'cancelled')).toBe(true);
    expect(canTransitionPrintRequestStatus('printed', 'cancelled')).toBe(false);
    expect(canTransitionPrintRequestStatus('completed', 'printed')).toBe(false);
    expect(canTransitionPrintRequestStatus('rejected', 'printed')).toBe(false);
  });
});
