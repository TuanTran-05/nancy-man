// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Assignments from './Assignments';
import { readChannel } from '../../lib/api/readApi';
import { deleteAuthoringDraft, listAuthoringDrafts } from '../../lib/api/assignmentAuthoringApi';
import { createBlankAuthoringDraft } from '../../../shared/assignmentAuthoring';
import { loadLocalDraft, saveLocalDraft } from '../../components/assignments/authoring/draftSync';

vi.mock('../../components/assignments/assessmentBuilder/AssessmentBuilder', () => ({
  AssessmentBuilder: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="Advanced assessment builder">
        Advanced assessment builder open
      </div>
    ) : null,
}));

vi.mock('../../components/assignments/SubmissionModal', () => ({
  SubmissionModal: ({
    isOpen,
    selectedAssignment,
    submissionExamActive,
    onStartExamSession,
    examMetrics,
    integrityOverlay,
  }: {
    isOpen: boolean;
    selectedAssignment: { title?: string } | null;
    submissionExamActive: boolean;
    onStartExamSession: () => Promise<void> | void;
    examMetrics: { focusLossCount: number };
    integrityOverlay:
      | null
      | { kind: 'tabfocus'; total: number }
      | { kind: 'fullscreen'; exitCount: number }
      | { kind: 'devtools'; total: number };
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Submission modal">
        <p>{selectedAssignment?.title}</p>
        <p>active:{String(submissionExamActive)}</p>
        <p>focusLoss:{examMetrics.focusLossCount}</p>
        {integrityOverlay ? <p>overlay:{integrityOverlay.kind}</p> : null}
        <button type="button" onClick={() => void onStartExamSession()}>
          Start assignment
        </button>
      </div>
    ) : null,
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn().mockResolvedValue({
    classes: [{ id: 'class-1', name: 'Class 1A' }],
  }),
}));

vi.mock('../../lib/api/assignmentAuthoringApi', () => ({
  listAuthoringDrafts: vi.fn().mockResolvedValue([
    {
      id: 'draft-1',
      ownerUid: 'teacher-1',
      title: 'Unit 2 Listening',
      description: '',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      attemptsAllowed: 1,
      proctoringMode: 'strict',
      assessmentDraft: {
        version: 2,
        mode: 'practice',
        settings: {
          allowFreeMediaPlayback: true,
          showCorrectAnswersAfterSubmit: false,
          showTranscriptDuringAttempt: false,
        },
        sections: [
          {
            id: 'section-1',
            title: 'Listening',
            skill: 'listening',
            questions: [
              {
                id: 'q1',
                skill: 'listening',
                prompt: 'Prompt',
                responseMode: 'multiple_choice',
                media: [],
                options: [
                  { key: 'A', text: 'A' },
                  { key: 'B', text: 'B' },
                ],
                correctAnswer: 'A',
              },
            ],
          },
        ],
      },
      status: 'draft',
      localRevision: 1,
      serverRevision: 1,
      createdAt: '2026-06-12T09:00:00.000Z',
      updatedAt: '2026-06-12T10:00:00.000Z',
      deliveryPolicy: {
        targetMode: 'class',
        assignedStudentIds: [],
        availableFrom: '',
        resultReleasePolicy: 'after_submit',
      },
    },
  ]),
  deleteAuthoringDraft: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'student-1' },
  }),
}));

vi.mock('../../hooks/usePollingStream', () => ({
  usePollingStream: vi.fn(({ topic }) => {
    if (topic === 'assignments') {
      return {
        data: [
          {
            id: 'a-1',
            title: 'Scheduled Assignment',
            classId: 'class-1',
            teacherId: 'teacher-1',
            dueDate: '2999-06-30T10:00:00.000Z',
            deliveryPolicy: {
              targetMode: 'class',
              assignedStudentIds: [],
              availableFrom: '2999-01-01T10:00:00.000Z',
              resultReleasePolicy: 'after_submit',
            },
          },
          {
            id: 'a-2',
            title: 'Targeted Assignment',
            classId: 'class-1',
            teacherId: 'teacher-1',
            dueDate: '2999-06-30T10:00:00.000Z',
            type: 'essay',
            proctoringMode: 'strict',
            deliveryPolicy: {
              targetMode: 'selected_students',
              assignedStudentIds: ['student-1'],
              availableFrom: '',
              resultReleasePolicy: 'after_due',
            },
          },
          {
            id: 'a-3',
            title: 'Manual Release Assignment',
            classId: 'class-1',
            teacherId: 'teacher-1',
            dueDate: '2999-06-30T10:00:00.000Z',
            type: 'essay',
            proctoringMode: 'normal',
            deliveryPolicy: {
              targetMode: 'class',
              assignedStudentIds: [],
              availableFrom: '',
              resultReleasePolicy: 'manual',
            },
          },
        ],
        loading: false,
      };
    }
    return { data: [], loading: false };
  }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: {
      pageAssignments: {
        filterByClass: 'Filter by class:',
        allClasses: 'All classes',
        addAssignment: 'Add assignment',
        addAdvancedAssignment: 'Add advanced assignment',
        classPrefix: 'Class: ',
        dueAt: 'Due at: ',
        submissionsCount: '{count} submissions',
        doAssignment: 'Do Assignment',
        reattempt: 'Reattempt {count}/{total}',
        viewDetails: 'View Details',
        submitted: 'Submitted',
        notSubmitted: 'Not Submitted',
        overdue: 'Overdue',
        advancedDrafts: {
          heading: 'Drafts',
          autoSaveNote: 'Auto-saved while editing',
          untitled: 'Untitled draft',
          missingClass: 'Missing class',
          missingDueDate: 'Missing due date',
          questions: 'questions',
          open: 'Open',
          delete: 'Delete',
          deleteConfirm: 'Delete this draft?',
          retry: 'Retry',
          updated: 'Updated',
          ready: 'Ready',
          needsDetails: 'Needs details',
          loadError: 'Could not load drafts',
          deleteError: 'Could not delete draft',
        },
      },
      classes: {
        permissionError: 'No attempts remaining',
      },
    },
  }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  db: {},
}));

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

describe('Assignments policy badges and availability', () => {
  const LocationProbe = () => {
    const location = useLocation();
    return <div data-testid="location">{location.pathname}</div>;
  };

  beforeEach(() => {
    vi.mocked(listAuthoringDrafts).mockClear();
    vi.mocked(deleteAuthoringDraft).mockClear();
    localStorage.clear();
  });

  it('renders allowed student assignment cards and hides scheduled assignments', async () => {
    render(
      <MemoryRouter>
        <Assignments
          profile={
            {
              uid: 'student-1',
              role: 'student',
              studentId: 'student-1',
              classId: 'class-1',
            } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Targeted Assignment')).toBeInTheDocument();
    expect(screen.getByText('Manual Release Assignment')).toBeInTheDocument();
    expect(screen.queryByText('Scheduled Assignment')).not.toBeInTheDocument();

    expect(screen.getByText('Selected students')).toBeInTheDocument();
    expect(screen.getByText('Answers after due date')).toBeInTheDocument();
    expect(screen.getByText('Manual release')).toBeInTheDocument();
  });

  it('renders Operations button for teacher cards and handles panel toggling', async () => {
    render(
      <MemoryRouter>
        <Assignments
          profile={
            {
              uid: 'teacher-1',
              role: 'teacher',
            } as any
          }
        />
      </MemoryRouter>
    );

    // Wait for assignments to be loaded
    expect(await screen.findByText('Scheduled Assignment')).toBeInTheDocument();

    // Verify Operations button is visible and can be clicked
    const opBtn = screen.getAllByRole('button', { name: 'Operations' })[0];
    expect(opBtn).toBeInTheDocument();
    fireEvent.click(opBtn);
  });

  it('renders Gmail-style advanced drafts for teachers and opens a draft route', async () => {
    render(
      <MemoryRouter>
        <LocationProbe />
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Unit 2 Listening')).toBeInTheDocument();
    expect(listAuthoringDrafts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Unit 2 Listening'));

    expect(screen.getByTestId('location')).toHaveTextContent('/assignments/advanced/draft-1');
  });

  it('shows local-only advanced drafts when server sync has not completed', async () => {
    vi.mocked(listAuthoringDrafts).mockResolvedValueOnce([]);
    saveLocalDraft({
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'local-only-draft',
      title: 'Recovered offline draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 4,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:30:00.000Z',
    });

    render(
      <MemoryRouter>
        <LocationProbe />
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Recovered offline draft')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Recovered offline draft'));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/assignments/advanced/local-only-draft'
    );
  });

  it('removes a local-only advanced draft without calling the server archive endpoint', async () => {
    vi.mocked(listAuthoringDrafts).mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    saveLocalDraft({
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'local-only-draft',
      title: 'Recovered offline draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 4,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:30:00.000Z',
    });

    render(
      <MemoryRouter>
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Recovered offline draft')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Recovered offline draft' }));

    expect(deleteAuthoringDraft).not.toHaveBeenCalled();
    expect(loadLocalDraft('local-only-draft')).toBeNull();
    expect(screen.queryByText('Recovered offline draft')).not.toBeInTheDocument();
  });

  it('reloads local advanced drafts when the teacher uid changes', async () => {
    vi.mocked(listAuthoringDrafts).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    saveLocalDraft({
      ...createBlankAuthoringDraft('teacher-1'),
      id: 'teacher-1-draft',
      title: 'Teacher one draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 1,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:00:00.000Z',
    });
    saveLocalDraft({
      ...createBlankAuthoringDraft('teacher-2'),
      id: 'teacher-2-draft',
      title: 'Teacher two draft',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      localRevision: 1,
      serverRevision: 0,
      updatedAt: '2026-06-12T10:05:00.000Z',
    });

    const { rerender } = render(
      <MemoryRouter>
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Teacher one draft')).toBeInTheDocument();
    expect(screen.queryByText('Teacher two draft')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Assignments profile={{ uid: 'teacher-2', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Teacher two draft')).toBeInTheDocument();
    expect(screen.queryByText('Teacher one draft')).not.toBeInTheDocument();
  });

  it('archives an advanced draft from the teacher draft list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter>
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Unit 2 Listening')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unit 2 Listening' }));

    expect(deleteAuthoringDraft).toHaveBeenCalledWith('draft-1');
  });

  it('hides advanced draft tools from students', async () => {
    render(
      <MemoryRouter>
        <Assignments
          profile={
            { uid: 'student-1', role: 'student', studentId: 'student-1', classId: 'class-1' } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Targeted Assignment')).toBeInTheDocument();
    expect(screen.queryByText('Unit 2 Listening')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add advanced assignment' })
    ).not.toBeInTheDocument();
  });

  it('routes the advanced assignment action to the teacher workbench', async () => {
    render(
      <MemoryRouter>
        <LocationProbe />
        <Assignments profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Scheduled Assignment')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add advanced assignment' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/assignments/advanced/new');
  });

  it('handles DevTools attempts inside strict active student submissions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Assignments
          profile={
            { uid: 'student-1', role: 'student', studentId: 'student-1', classId: 'class-1' } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Targeted Assignment')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Do Assignment' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Start assignment' }));
    await waitFor(() => expect(screen.getByText('active:true')).toBeInTheDocument());

    const event = new CustomEvent('edutrack:blockdevtool-attempt', {
      cancelable: true,
      detail: { trigger: 'keyboard', key: 'F12', returnPath: '/assignments' },
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText('overlay:devtools')).toBeInTheDocument(), {
      timeout: 5000,
    });
    await waitFor(() => expect(screen.getByText('focusLoss:1')).toBeInTheDocument(), {
      timeout: 5000,
    });
  });

  it('keeps the DevTools warning visible when the attempt reaches the focus warning threshold', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Assignments
          profile={
            { uid: 'student-1', role: 'student', studentId: 'student-1', classId: 'class-1' } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Targeted Assignment')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Do Assignment' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Start assignment' }));
    await waitFor(() => expect(screen.getByText('active:true')).toBeInTheDocument());

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const event = new CustomEvent('edutrack:blockdevtool-attempt', {
        cancelable: true,
        detail: { trigger: 'keyboard', key: 'F12', returnPath: '/assignments' },
      });

      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.getByText('overlay:devtools')).toBeInTheDocument(), {
        timeout: 5000,
      });
      expect(screen.queryByText('overlay:tabfocus')).not.toBeInTheDocument();
    }
  });

  it('keeps blocking DevTools attempts while focus loss state updates commit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const originalRemoveEventListener = window.removeEventListener.bind(window);
    const unhandledDuringHandlerRefresh: boolean[] = [];
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(((
      type,
      listener,
      options
    ) => {
      originalRemoveEventListener(type, listener, options);
      if (type !== 'edutrack:blockdevtool-attempt') return;

      const event = new CustomEvent('edutrack:blockdevtool-attempt', {
        cancelable: true,
        detail: { trigger: 'keyboard', key: 'F12', returnPath: '/assignments' },
      });
      window.dispatchEvent(event);
      if (!event.defaultPrevented) {
        unhandledDuringHandlerRefresh.push(event.defaultPrevented);
      }
    }) as typeof window.removeEventListener);

    render(
      <MemoryRouter>
        <Assignments
          profile={
            { uid: 'student-1', role: 'student', studentId: 'student-1', classId: 'class-1' } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Targeted Assignment')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Do Assignment' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Start assignment' }));
    await waitFor(() => expect(screen.getByText('active:true')).toBeInTheDocument());

    const event = new CustomEvent('edutrack:blockdevtool-attempt', {
      cancelable: true,
      detail: { trigger: 'keyboard', key: 'F12', returnPath: '/assignments' },
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText('focusLoss:1')).toBeInTheDocument(), {
      timeout: 5000,
    });
    removeEventListenerSpy.mockRestore();
    expect(unhandledDuringHandlerRefresh).toEqual([]);
  });

  it('lets normal active submissions continue to the blockdevtool page', async () => {
    render(
      <MemoryRouter>
        <Assignments
          profile={
            { uid: 'student-1', role: 'student', studentId: 'student-1', classId: 'class-1' } as any
          }
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Manual Release Assignment')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Do Assignment' })[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Start assignment' }));

    const event = new CustomEvent('edutrack:blockdevtool-attempt', {
      cancelable: true,
      detail: { trigger: 'keyboard', key: 'F12', returnPath: '/assignments' },
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText('overlay:devtools')).not.toBeInTheDocument();
  });
});
