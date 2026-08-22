// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssignmentAuthoringWorkbench from './AssignmentAuthoringWorkbench';
import {
  getAuthoringDraft,
  publishAuthoringDraft,
  saveAuthoringDraft,
  previewAuthoringImport,
} from '../../lib/api/assignmentAuthoringApi';
import {
  applyStructureTemplate,
  createBlankAuthoringDraft,
  type AssignmentAuthoringDraft,
} from '../../../shared/assignmentAuthoring';
import {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
} from '../../components/assignments/authoring/draftSync';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      assignmentWorkbench: {
        title: 'Assignment workbench',
        subtitle: 'Build advanced assignments faster.',
        leftRail: 'Structure',
        mainEditor: 'Editor',
        rightPanel: 'Reusable tools',
        couldNotLoadDraft: 'Could not load draft',
        backToAssignments: 'Back to assignments',
        assignmentTitlePlaceholder: 'Assignment title',
        previewButton: 'Preview',
        draftLabel: 'Draft {id}',
        newDraftLabel: 'New draft',
        importReport: 'Imported from {filename} - {valid} valid / {errors} errors',
        settingsTitle: 'Assignment settings',
        descriptionLabel: 'Description',
        classLabel: 'Class',
        selectClassPlaceholder: 'Select class',
        dueDateLabel: 'Due date',
        attemptsLabel: 'Attempts',
        proctoringLabel: 'Proctoring',
        proctoringStrict: 'Strict',
        proctoringNormal: 'Normal',
        savedToBankSuccess: 'Saved to question bank',
        publishedSuccess: 'Assignment published: {id}',
        publishError: 'Could not publish assignment',
        importReplaceSuccess: 'Replaced draft with {count} imported question(s)',
        importAddSuccess: 'Added {count} imported question(s)',
      },
    },
  }),
}));

vi.mock('../../lib/api/assignmentAuthoringApi', () => ({
  getAuthoringDraft: vi.fn(),
  publishAuthoringDraft: vi.fn().mockResolvedValue('assignment-1'),
  saveAuthoringDraft: vi.fn(async (draft) => ({ ...draft, serverRevision: 1 })),
  searchQuestionBank: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  createQuestionBankItem: vi.fn().mockResolvedValue({ id: 'bank-q1' }),
  reviewQuestionBankItem: vi.fn().mockResolvedValue(undefined),
  searchMediaBank: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  previewAuthoringImport: vi.fn(),
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn().mockResolvedValue({
    classes: [{ id: 'class-1', name: 'A1', teacherId: 'teacher-1', status: 'active' }],
  }),
}));

vi.mock('../../lib/api/studentDirectoryApi', () => ({
  getStudentDirectory: vi.fn().mockResolvedValue({
    students: [
      { id: 'student-1', name: 'Student One', classId: 'class-1' },
      { id: 'student-2', name: 'Student Two', classId: 'class-2' },
    ],
  }),
}));

vi.mock('../../components/assignments/authoring/draftSync', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../components/assignments/authoring/draftSync')>();
  return {
    ...original,
    scheduleServerDraftSync: vi.fn(async (draft) => {
      return saveAuthoringDraft(draft);
    }),
  };
});

describe('AssignmentAuthoringWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(saveAuthoringDraft).mockImplementation(async (draft) => ({
      ...(draft as Record<string, unknown>),
      serverRevision: 1,
    }));
    vi.mocked(publishAuthoringDraft).mockResolvedValue('assignment-1');
    vi.mocked(getAuthoringDraft).mockReset();
  });

  function renderWorkbench(
    path = '/assignments/advanced/new',
    route = '/assignments/advanced/new'
  ) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={route}
            element={
              <AssignmentAuthoringWorkbench
                profile={{ uid: 'teacher-1', role: 'teacher' } as any}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders the Google Forms style authoring shell', () => {
    renderWorkbench();

    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Assignment title on canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add question' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('opens settings from the settings tab', () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Assignment settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Class assignment')).toBeInTheDocument();
  });

  it('saves the current editable draft before publishing', async () => {
    renderWorkbench();

    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Listening unit 1' },
    });
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'What does the speaker want?' },
    });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A ticket' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'A book' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await screen.findByRole('option', { name: 'A1' });
    fireEvent.change(screen.getByLabelText('Class assignment'), { target: { value: 'class-1' } });
    await waitFor(() => expect(getStudentDirectory).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '10:00 30/06/2026' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Publish/i })[0]);

    await waitFor(() =>
      expect(saveAuthoringDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Listening unit 1',
          classId: 'class-1',
          dueDate: '10:00 30/06/2026',
          assessmentDraft: expect.objectContaining({
            sections: [
              expect.objectContaining({
                questions: [
                  expect.objectContaining({
                    prompt: 'What does the speaker want?',
                    options: [
                      { key: 'A', text: 'A ticket' },
                      { key: 'B', text: 'A book' },
                    ],
                    correctAnswer: 'A',
                  }),
                ],
              }),
            ],
          }),
        })
      )
    );
    expect(publishAuthoringDraft).toHaveBeenCalledWith(expect.any(String));
  });

  it('loads an existing draft when the route has a draft id', async () => {
    const loadedDraft: AssignmentAuthoringDraft = {
      ...applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'listening-practice'),
      id: 'draft-123',
      title: 'Loaded draft',
      classId: 'class-1',
      dueDate: '10:00 30/06/2026',
      serverRevision: 3,
    };
    vi.mocked(getAuthoringDraft).mockResolvedValue(loadedDraft);

    renderWorkbench('/assignments/advanced/draft-123', '/assignments/advanced/:draftId');

    await waitFor(() => expect(getAuthoringDraft).toHaveBeenCalledWith('draft-123'));
    expect(await screen.findByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Loaded draft'
    );
  });

  it('opens the student preview from the workbench header', async () => {
    renderWorkbench();

    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Preview unit' },
    });
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'What does the speaker want?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('dialog', { name: 'Student preview' })).toBeInTheDocument();
    expect(screen.getByText('Preview unit')).toBeInTheDocument();
    expect(screen.getAllByText('What does the speaker want?').length).toBeGreaterThan(1);
  });

  it('shows publish readiness blockers and jumps to the target question', async () => {
    const loadedDraft: AssignmentAuthoringDraft = {
      ...applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'listening-practice'),
      id: 'draft-issues',
      title: 'Loaded draft',
      classId: 'class-1',
      dueDate: '10:00 30/06/2026',
    };
    loadedDraft.assessmentDraft.sections[0].questions[0] = {
      ...loadedDraft.assessmentDraft.sections[0].questions[0],
      prompt: 'Complete question',
      options: [
        { key: 'A', text: 'Alpha' },
        { key: 'B', text: 'Beta' },
      ],
      correctAnswer: 'A',
    };
    loadedDraft.assessmentDraft.sections[0].questions[1] = {
      ...loadedDraft.assessmentDraft.sections[0].questions[1],
      prompt: '',
    };
    vi.mocked(getAuthoringDraft).mockResolvedValue(loadedDraft);

    renderWorkbench('/assignments/advanced/draft-issues', '/assignments/advanced/:draftId');

    await screen.findByRole('textbox', { name: 'Assignment title' });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: /Fix Question 2 prompt is required/i }));

    expect(screen.getByRole('textbox', { name: 'Question 2 prompt' })).toHaveValue('');
  });

  it('blocks publish through readiness validation before saving', async () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(saveAuthoringDraft).not.toHaveBeenCalled());
    expect(publishAuthoringDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByText(/Fix [0-9]+ issue/)).toBeInTheDocument();
  });

  it('focuses assignment basics from readiness issue actions', async () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await screen.findByRole('option', { name: 'A1' });

    const titleInput = screen.getByRole('textbox', { name: 'Assignment title' });
    fireEvent.click(screen.getByRole('button', { name: 'Fix Title is required.' }));

    await waitFor(() => expect(titleInput).toHaveFocus());

    const classField = screen.getByLabelText('Class assignment');
    fireEvent.click(screen.getByRole('button', { name: 'Fix Class is required.' }));

    await waitFor(() => expect(classField).toHaveFocus());

    const dueDateField = screen.getByLabelText('Due date');
    fireEvent.click(screen.getByRole('button', { name: 'Fix Due date is required.' }));

    await waitFor(() => expect(dueDateField).toHaveFocus());
  });

  function mockImportPreview() {
    vi.mocked(previewAuthoringImport).mockResolvedValue({
      source: 'csv',
      filename: 'unit.csv',
      totalQuestions: 1,
      validQuestions: 1,
      warningCount: 0,
      errorCount: 0,
      sections: [
        {
          title: 'Imported Reading',
          skill: 'reading',
          questions: [
            {
              skill: 'reading',
              responseMode: 'short_answer',
              prompt: 'Imported prompt',
              media: [],
              acceptedAnswers: ['answer'],
              gradingMode: 'manual',
              points: 1,
              level: 'A2',
            },
          ],
        },
      ],
      issues: [],
      editableRows: [
        {
          rowId: 'row-2',
          sourceRow: 2,
          section: 'Imported Reading',
          skill: 'reading',
          responseMode: 'short_answer',
          prompt: 'Imported prompt',
          instructions: '',
          optionA: '',
          optionB: '',
          optionC: '',
          optionD: '',
          correctAnswer: '',
          acceptedAnswers: 'answer',
          points: '1',
          level: 'A2',
          mediaUrl: '',
          mediaType: '',
          transcript: '',
        },
      ],
    });
  }

  it.skip('appends imported questions into the workbench draft', async () => {
    mockImportPreview();
    renderWorkbench();

    fireEvent.change(screen.getByLabelText('Question prompt'), {
      target: { value: 'Default prompt' },
    });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'B' } });

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 valid');
    fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));

    expect(screen.getByDisplayValue('Imported prompt')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Imported assignment' },
    });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '10:00 30/06/2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Publish/i }));

    await waitFor(() =>
      expect(saveAuthoringDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentDraft: expect.objectContaining({
            sections: expect.arrayContaining([
              expect.objectContaining({
                title: 'Imported Reading',
                questions: [expect.objectContaining({ prompt: 'Imported prompt' })],
              }),
            ]),
          }),
        })
      )
    );
  });

  it.skip('replaces current draft sections with imported sections', async () => {
    mockImportPreview();
    renderWorkbench();

    expect(screen.getByRole('button', { name: 'Listening' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 valid');
    fireEvent.click(screen.getByRole('button', { name: 'Replace draft' }));

    expect(screen.getByDisplayValue('Imported prompt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Listening question/i })).not.toBeInTheDocument();
  });

  it.skip('shows the last import report after applying an import', async () => {
    mockImportPreview();
    renderWorkbench();

    fireEvent.change(screen.getByLabelText('Import assignment file'), {
      target: { files: [new File(['csv'], 'unit.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('1 valid');
    fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));

    expect(screen.getByText('Imported from unit.csv - 1 valid / 0 errors')).toBeInTheDocument();
  });

  it.skip('allows multi-selecting questions, applying bulk edit, and publishing', async () => {
    renderWorkbench();

    // Select the listening practice template
    const templateBtns = screen.getAllByRole('button', { name: /Listening practice/i });
    fireEvent.click(templateBtns[0]);

    // Wait for the template questions to render (it adds 3 questions)
    expect(await screen.findByRole('button', { name: '1. Untitled question' })).toBeInTheDocument();

    // Fill in question 1
    fireEvent.click(screen.getByRole('button', { name: '1. Untitled question' }));
    fireEvent.change(screen.getByLabelText('Question prompt'), { target: { value: 'Prompt 1' } });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'B' } });

    // Fill in question 2
    fireEvent.click(screen.getByRole('button', { name: '2. Untitled question' }));
    fireEvent.change(screen.getByLabelText('Question prompt'), { target: { value: 'Prompt 2' } });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'B' } });

    // Fill in question 3
    fireEvent.click(screen.getByRole('button', { name: '3. Untitled question' }));
    fireEvent.change(screen.getByLabelText('Question prompt'), { target: { value: 'Prompt 3' } });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'B' } });

    // Check checkboxes for first and second questions in the rail
    const checkboxes = screen.getAllByRole('checkbox', { name: /^Select question/ });
    expect(checkboxes).toHaveLength(3);
    fireEvent.click(checkboxes[1]);

    // Verify bulk edit panel renders selected count
    expect((await screen.findAllByText(/2\s+selected/i)).length).toBeGreaterThanOrEqual(1);

    // Enter bulk points and apply
    fireEvent.change(screen.getByLabelText('Bulk points'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk edit' }));

    // Now fill in basic fields so we can publish
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Bulk edited homework' },
    });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '10:00 30/06/2026' },
    });

    // Publish the draft
    fireEvent.click(screen.getByRole('button', { name: /Publish/i }));

    await waitFor(() =>
      expect(saveAuthoringDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bulk edited homework',
          assessmentDraft: expect.objectContaining({
            sections: [
              expect.objectContaining({
                questions: expect.arrayContaining([expect.objectContaining({ points: 3 })]),
              }),
            ],
          }),
        })
      )
    );
  });

  it('uses local draft data immediately before server draft finishes loading', async () => {
    const localDraft: AssignmentAuthoringDraft = {
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'draft-local',
      title: 'Local recovered draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
    };
    saveLocalDraft(localDraft);
    vi.mocked(getAuthoringDraft).mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve({ ...localDraft, title: 'Server draft' }), 100);
        })
    );

    renderWorkbench('/assignments/advanced/draft-local', '/assignments/advanced/:draftId');

    expect(await screen.findByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Local recovered draft'
    );
  });

  it('keeps a newer local draft after an older server draft finishes loading', async () => {
    const localDraft: AssignmentAuthoringDraft = {
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'draft-local-newer',
      title: 'Newer local draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 5,
      serverRevision: 1,
      updatedAt: '2026-06-12T10:30:00.000Z',
    };
    const serverDraft: AssignmentAuthoringDraft = {
      ...localDraft,
      title: 'Older server draft',
      localRevision: 2,
      serverRevision: 2,
      updatedAt: '2026-06-12T10:00:00.000Z',
    };
    let resolveServerDraft: (draft: AssignmentAuthoringDraft) => void = () => {};
    vi.mocked(getAuthoringDraft).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveServerDraft = resolve;
        })
    );
    saveLocalDraft(localDraft);

    renderWorkbench('/assignments/advanced/draft-local-newer', '/assignments/advanced/:draftId');

    expect(await screen.findByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Newer local draft'
    );

    await act(async () => {
      resolveServerDraft(serverDraft);
    });

    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Newer local draft'
    );
    expect(screen.queryByDisplayValue('Older server draft')).not.toBeInTheDocument();
  });

  it('keeps editing a local-only draft when the server draft is missing', async () => {
    const localDraft: AssignmentAuthoringDraft = {
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'local-only-draft',
      title: 'Recovered offline draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 4,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:30:00.000Z',
    };
    saveLocalDraft(localDraft);
    vi.mocked(getAuthoringDraft).mockRejectedValue(new Error('Draft not found'));

    renderWorkbench('/assignments/advanced/local-only-draft', '/assignments/advanced/:draftId');

    await waitFor(() => expect(getAuthoringDraft).toHaveBeenCalledWith('local-only-draft'));

    expect(screen.queryByText('Could not load draft')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Recovered offline draft'
    );
    await waitFor(() => {
      expect(saveAuthoringDraft).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'local-only-draft', title: 'Recovered offline draft' })
      );
    });
  });

  it('does not hydrate a local draft owned by another teacher', async () => {
    const otherTeacherDraft: AssignmentAuthoringDraft = {
      ...createBlankAuthoringDraft('teacher-2'),
      id: 'other-teacher-draft',
      title: 'Other teacher draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 4,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:30:00.000Z',
    };
    saveLocalDraft(otherTeacherDraft);
    vi.mocked(getAuthoringDraft).mockRejectedValue(new Error('Draft not found'));

    renderWorkbench('/assignments/advanced/other-teacher-draft', '/assignments/advanced/:draftId');

    await waitFor(() => expect(getAuthoringDraft).toHaveBeenCalledWith('other-teacher-draft'));

    expect(await screen.findByText('Could not load draft')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Other teacher draft')).not.toBeInTheDocument();
    expect(saveAuthoringDraft).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'other-teacher-draft', title: 'Other teacher draft' })
    );
  });

  it('does not overwrite edits made while a server draft is still loading', async () => {
    const localDraft: AssignmentAuthoringDraft = {
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'draft-load-race',
      title: 'Local draft before edit',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 1,
      serverRevision: 1,
      updatedAt: '2026-06-12T10:00:00.000Z',
    };
    const staleServerDraft: AssignmentAuthoringDraft = {
      ...localDraft,
      title: 'Stale server draft',
      updatedAt: '2026-06-12T10:05:00.000Z',
    };
    let resolveServerDraft: (draft: AssignmentAuthoringDraft) => void = () => {};
    vi.mocked(getAuthoringDraft).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveServerDraft = resolve;
        })
    );
    saveLocalDraft(localDraft);

    renderWorkbench('/assignments/advanced/draft-load-race', '/assignments/advanced/:draftId');

    const titleInput = await screen.findByRole('textbox', { name: 'Assignment title' });
    fireEvent.change(titleInput, { target: { value: 'Edited while loading' } });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveValue(
        'Edited while loading'
      )
    );

    await act(async () => {
      resolveServerDraft(staleServerDraft);
    });

    expect(screen.getByRole('textbox', { name: 'Assignment title' })).toHaveValue(
      'Edited while loading'
    );
    expect(screen.queryByDisplayValue('Stale server draft')).not.toBeInTheDocument();
  });

  it('clears the local draft after a successful publish', async () => {
    renderWorkbench();

    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Publish cleanup' },
    });
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'What does the speaker want?' },
    });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A ticket' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'A book' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await screen.findByRole('option', { name: 'A1' });
    fireEvent.change(screen.getByLabelText('Class assignment'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '10:00 30/06/2026' },
    });

    const draftId = Object.keys(localStorage).find((key) =>
      key.startsWith('assignment-authoring-draft:')
    );
    expect(draftId).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: /Publish/i })[0]);

    await waitFor(() => expect(publishAuthoringDraft).toHaveBeenCalled());
    expect(loadLocalDraft(draftId!.replace('assignment-authoring-draft:', ''))).toBeNull();
  });

  it('shows a conflict state when server draft sync returns a conflict', async () => {
    vi.mocked(saveAuthoringDraft).mockRejectedValueOnce(
      Object.assign(new Error('Draft conflict'), { status: 409 })
    );
    renderWorkbench();

    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment title' }), {
      target: { value: 'Conflict draft' },
    });

    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
  });
});
