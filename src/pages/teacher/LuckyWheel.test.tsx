// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LuckyWheel from './LuckyWheel';

const animationControls = vi.hoisted(() => ({
  start: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: {
      luckyWheelPage: {
        title: 'Lucky Wheel',
        subtitle: 'Surprise & Fun',
        description: 'Spin the wheel to call a random student.',
        selectClass: '-- Select Class --',
        spinNow: 'SPIN NOW',
        selectedStudent: 'SELECTED STUDENT',
        almost: 'Almost:',
        butItIs: 'But it is:',
        wheelSettings: 'Wheel Settings',
        autoFromDatabase: 'Auto-load from class',
        noClasses: 'No classes',
        orManual: 'Or enter manually',
        listLabel: 'List',
        inputPlaceholder: 'Enter student names...',
        studentCount: '{count} students listed.',
        trollMode: 'Troll Mode',
        trollHint: 'Suggestion: Keep at 10%.',
        saveAndSpin: 'Save & Spin',
        removeSelectedStudent: 'Remove',
        continueSpinning: 'Continue',
        resetWheelSession: 'Reset',
      },
    },
  }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher One' },
  }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  db: {},
}));

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  const passthrough =
    <T extends HTMLElement>(Tag: keyof React.JSX.IntrinsicElements) =>
    ({
      children,
      initial,
      animate,
      exit,
      transition,
      whileHover,
      whileTap,
      ...props
    }: React.HTMLAttributes<T> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      whileHover?: unknown;
      whileTap?: unknown;
    }) =>
      ReactModule.createElement(Tag, props, children);

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: passthrough<HTMLDivElement>('div'),
      p: passthrough<HTMLParagraphElement>('p'),
      h3: passthrough<HTMLHeadingElement>('h3'),
    },
    useAnimationControls: () => animationControls,
  };
});

const configureManualStudents = (names: string[]) => {
  fireEvent.click(screen.getAllByRole('button')[0]);
  fireEvent.change(screen.getByPlaceholderText('Enter student names...'), {
    target: { value: names.join('\n') },
  });
  fireEvent.click(screen.getByText('Save & Spin'));
};

const spinNormallySelectingFirstStudent = async () => {
  fireEvent.click(screen.getByText('SPIN NOW'));

  return waitFor(() => {
    const winnerElement = screen
      .getAllByText('Student A')
      .find((element) => element.tagName.toLowerCase() !== 'text');
    expect(winnerElement).toBeDefined();
    return winnerElement as HTMLElement;
  });
};

describe('LuckyWheel', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    animationControls.start.mockReset();
    animationControls.set.mockReset();
  });

  it('does not show the crossed-out near miss student in the final troll result', async () => {
    animationControls.start.mockResolvedValue(undefined);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);

    render(<LuckyWheel />);

    configureManualStudents(['Student A', 'Student B']);

    fireEvent.click(screen.getByText('SPIN NOW'));

    const finalWinner = await waitFor(() => {
      const winnerElement = screen
        .getAllByText('Student B')
        .find((element) => element.tagName.toLowerCase() !== 'text');
      expect(winnerElement).toBeDefined();
      return winnerElement as HTMLElement;
    });
    const resultCard = finalWinner?.closest('div');

    expect(resultCard).toBeTruthy();
    expect(resultCard?.querySelector('.line-through')).toBeNull();
    expect(within(resultCard as HTMLElement).queryByText(/Student A/)).not.toBeInTheDocument();
  });

  it('removes the selected student from the current wheel session', async () => {
    animationControls.start.mockResolvedValue(undefined);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0);

    render(<LuckyWheel />);

    configureManualStudents(['Student A', 'Student B']);
    await spinNormallySelectingFirstStudent();

    fireEvent.click(screen.getByText('Remove'));

    expect(screen.queryByText('SELECTED STUDENT')).not.toBeInTheDocument();
    expect(screen.queryByText('Student A')).not.toBeInTheDocument();
    expect(screen.getByText('Student B')).toBeInTheDocument();
  });

  it('resets removed students back into the current wheel session', async () => {
    animationControls.start.mockResolvedValue(undefined);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0);

    render(<LuckyWheel />);

    configureManualStudents(['Student A', 'Student B']);
    await spinNormallySelectingFirstStudent();
    fireEvent.click(screen.getByText('Remove'));

    expect(screen.queryByText('Student A')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Reset'));

    expect(screen.queryByText('SELECTED STUDENT')).not.toBeInTheDocument();
    expect(screen.getByText('Student A')).toBeInTheDocument();
    expect(screen.getByText('Student B')).toBeInTheDocument();
  });

  it('continues without removing the selected student from the current wheel session', async () => {
    animationControls.start.mockResolvedValue(undefined);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0);

    render(<LuckyWheel />);

    configureManualStudents(['Student A', 'Student B']);
    await spinNormallySelectingFirstStudent();

    fireEvent.click(screen.getByText('Continue'));

    expect(screen.queryByText('SELECTED STUDENT')).not.toBeInTheDocument();
    expect(screen.getByText('Student A')).toBeInTheDocument();
    expect(screen.getByText('Student B')).toBeInTheDocument();
  });
});
