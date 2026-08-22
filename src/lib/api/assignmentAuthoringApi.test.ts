import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import {
  createQuestionBankItem,
  listAuthoringDrafts,
  saveAuthoringDraft,
  searchMediaBank,
  searchQuestionBank,
  submitQuestionBankReview,
  previewAuthoringImport,
  downloadAuthoringImportTemplate,
} from './assignmentAuthoringApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('assignmentAuthoringApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a draft through the edu draft action', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: { id: 'draft-1' } });
    const result = await saveAuthoringDraft({
      id: 'draft-1',
      serverRevision: 0,
      assessmentDraft: { version: 2, sections: [] },
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/edu/assignment-draft-save', {
      method: 'POST',
      body: { id: 'draft-1', serverRevision: 0, assessmentDraft: { version: 2, sections: [] } },
    });
    expect(result).toEqual({ id: 'draft-1' });
  });

  it('lists drafts', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: [{ id: 'draft-1' }] });

    await expect(listAuthoringDrafts()).resolves.toEqual([{ id: 'draft-1' }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/edu/assignment-draft-list');
  });

  it('creates a question bank item', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: { id: 'bank-q1' } });

    await createQuestionBankItem({
      prompt: 'Prompt',
      skill: 'listening',
      responseMode: 'short_answer',
      media: [],
      tags: [],
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/edu/assessment-question-bank-create', {
      method: 'POST',
      body: {
        prompt: 'Prompt',
        skill: 'listening',
        responseMode: 'short_answer',
        media: [],
        tags: [],
      },
    });
  });

  it('searches question bank with query params', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      data: { items: [], nextCursor: null },
    });

    await searchQuestionBank({ skill: 'reading', q: 'travel' });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/edu/assessment-question-bank-search?skill=reading&q=travel'
    );
  });

  it('searches media bank with query params', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      data: { items: [], nextCursor: null },
    });

    await searchMediaBank({ type: 'audio', q: 'dialogue' });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/edu/assessment-media-bank-search?type=audio&q=dialogue'
    );
  });

  it('submits a question bank item for review', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    await submitQuestionBankReview('bank-q1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/edu/assessment-question-bank-submit-review', {
      method: 'POST',
      body: { id: 'bank-q1' },
    });
  });

  it('uploads an authoring import file as multipart form data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            source: 'csv',
            filename: 'unit.csv',
            totalQuestions: 1,
            validQuestions: 1,
            warningCount: 0,
            errorCount: 0,
            sections: [],
            issues: [],
          },
        })
      ),
    } as any);

    const result = await previewAuthoringImport(
      new File(['a,b'], 'unit.csv', { type: 'text/csv' })
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-draft-import-preview',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: expect.any(FormData),
      })
    );
    expect(result.filename).toBe('unit.csv');
  });

  it('delegates import authentication to the same-origin session cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            source: 'csv',
            filename: 'unit.csv',
            totalQuestions: 0,
            validQuestions: 0,
            warningCount: 0,
            errorCount: 0,
            sections: [],
            issues: [],
          },
        })
      ),
    } as any);

    await previewAuthoringImport(new File(['a,b'], 'unit.csv', { type: 'text/csv' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-draft-import-preview',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('downloads an authoring import template as a blob', async () => {
    const blob = new Blob(['section,skill'], { type: 'text/csv' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="assignment-import-template.csv"',
      }),
      blob: vi.fn().mockResolvedValue(blob),
      text: vi.fn(),
    } as any);

    const result = await downloadAuthoringImportTemplate('csv');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-draft-import-template?format=csv',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
    );
    expect(result).toEqual({
      filename: 'assignment-import-template.csv',
      blob,
    });
  });
});
