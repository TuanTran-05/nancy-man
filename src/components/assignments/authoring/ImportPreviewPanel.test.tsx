// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportPreviewPanel } from './ImportPreviewPanel';
import {
  downloadAuthoringImportTemplate,
  previewAuthoringImport,
} from '../../../lib/api/assignmentAuthoringApi';
import type { AuthoringImportPreview } from '../../../../shared/assignmentAuthoring';

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  previewAuthoringImport: vi.fn(),
  downloadAuthoringImportTemplate: vi.fn(),
}));

function preview(overrides: Partial<AuthoringImportPreview> = {}): AuthoringImportPreview {
  return {
    source: 'csv',
    filename: 'unit.csv',
    totalQuestions: 2,
    validQuestions: 1,
    warningCount: 1,
    errorCount: 1,
    sections: [
      {
        title: 'Listening',
        skill: 'listening',
        questions: [
          {
            skill: 'listening',
            responseMode: 'short_answer',
            prompt: 'Write the word.',
            media: [],
            acceptedAnswers: ['ticket'],
            gradingMode: 'manual',
            points: 1,
          },
        ],
      },
    ],
    issues: [
      {
        severity: 'error',
        code: 'multiple_choice_options_required',
        message: 'Multiple-choice questions need at least two options.',
        row: 3,
        field: 'options',
      },
      {
        severity: 'warning',
        code: 'level_missing',
        message: 'Level is missing.',
        row: 2,
        field: 'level',
      },
    ],
    editableRows: [
      {
        rowId: 'row-2',
        sourceRow: 2,
        section: 'Listening',
        skill: 'listening',
        responseMode: '',
        prompt: 'Write the word.',
        instructions: '',
        optionA: '',
        optionB: '',
        optionC: '',
        optionD: '',
        correctAnswer: '',
        acceptedAnswers: 'ticket',
        points: '1',
        level: '',
        mediaUrl: '',
        mediaType: '',
        transcript: '',
      },
    ],
    ...overrides,
  };
}

describe('ImportPreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previews a selected import file and applies append by default', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(preview());
    const onApply = vi.fn();
    render(<ImportPreviewPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByText('1 valid')).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
    expect(screen.getByText('1 error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'unit.csv' }),
      'append'
    );
  });

  it('applies replace when replace mode is selected', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(preview());
    const onApply = vi.fn();
    render(<ImportPreviewPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 valid');
    fireEvent.click(screen.getByRole('button', { name: 'Replace draft' }));

    expect(onApply).toHaveBeenCalledWith(expect.anything(), 'replace');
  });

  it('disables apply when preview has no valid questions', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(
      preview({ validQuestions: 0, sections: [] })
    );
    render(<ImportPreviewPanel onApply={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    await screen.findByText('0 valid');
    expect(screen.getByRole('button', { name: 'Append to draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace draft' })).toBeDisabled();
  });

  it('shows preview errors from the API', async () => {
    vi.mocked(previewAuthoringImport).mockRejectedValue(new Error('Unsupported import file type'));
    render(<ImportPreviewPanel onApply={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['txt'], 'unit.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    await waitFor(() =>
      expect(screen.getByText('Unsupported import file type')).toBeInTheDocument()
    );
  });

  it('downloads import templates from template buttons', async () => {
    const blob = new Blob(['template'], { type: 'text/csv' });
    vi.mocked(downloadAuthoringImportTemplate).mockResolvedValue({
      filename: 'assignment-import-template.csv',
      blob,
    });
    const createObjectUrl = vi.fn().mockReturnValue('blob:template');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as any;
      if (tagName === 'a') element.click = click;
      return element;
    });

    render(<ImportPreviewPanel onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV template' }));

    await waitFor(() => expect(downloadAuthoringImportTemplate).toHaveBeenCalledWith('csv'));
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalled();
    appendChild.mockRestore();
    removeChild.mockRestore();
    createElement.mockRestore();
  });

  it('repairs an invalid row and applies the repaired preview', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(
      preview({
        validQuestions: 0,
        errorCount: 1,
        sections: [],
        issues: [
          {
            severity: 'error',
            code: 'invalid_response_mode',
            message: 'Response mode is invalid.',
            row: 2,
            questionNumber: 1,
            field: 'responseMode',
          },
        ],
      })
    );
    const onApply = vi.fn();
    render(<ImportPreviewPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('0 valid');

    fireEvent.change(screen.getByLabelText('Row 2 response mode'), {
      target: { value: 'short_answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revalidate import rows' }));

    expect(await screen.findByText('1 valid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        validQuestions: 1,
        sections: [
          expect.objectContaining({
            questions: [expect.objectContaining({ responseMode: 'short_answer' })],
          }),
        ],
      }),
      'append'
    );
  });

  it('revalidates current row edits before applying', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(
      preview({
        errorCount: 0,
        warningCount: 0,
        issues: [],
        editableRows: [
          {
            rowId: 'row-2',
            sourceRow: 2,
            section: 'Listening',
            skill: 'listening',
            responseMode: 'short_answer',
            prompt: 'Write the word.',
            instructions: '',
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
            correctAnswer: '',
            acceptedAnswers: 'ticket',
            points: '1',
            level: 'A2',
            mediaUrl: '',
            mediaType: '',
            transcript: '',
          },
        ],
      })
    );
    const onApply = vi.fn();
    render(<ImportPreviewPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 valid');

    fireEvent.change(screen.getByLabelText('Row 2 response mode'), {
      target: { value: 'multiple_choice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(await screen.findByText('0 valid')).toBeInTheDocument();
    expect(
      screen.getByText('Multiple-choice questions need at least two options.')
    ).toBeInTheDocument();
  });

  it('shows repair inputs for every editable import field', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(preview());
    render(<ImportPreviewPanel onApply={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('Repair rows');

    [
      'section',
      'skill',
      'response mode',
      'prompt',
      'instructions',
      'option a',
      'option b',
      'option c',
      'option d',
      'correct answer',
      'accepted answers',
      'points',
      'level',
      'media url',
      'media type',
      'transcript',
    ].forEach((field) => {
      expect(screen.getByLabelText(`Row 2 ${field}`)).toBeInTheDocument();
    });
  });

  it('exports the current issue report as csv', async () => {
    vi.mocked(previewAuthoringImport).mockResolvedValue(preview());
    const createObjectUrl = vi.fn().mockReturnValue('blob:issues');
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrl,
      revokeObjectURL: vi.fn(),
    });
    const click = vi.fn();
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as any;
      if (tagName === 'a') element.click = click;
      return element;
    });

    render(<ImportPreviewPanel onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 error');
    fireEvent.click(screen.getByRole('button', { name: 'Export issue CSV' }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    createElement.mockRestore();
  });
});
