// @vitest-environment jsdom
import type React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EvaluationModal } from './EvaluationModal';

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('../common/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('EvaluationModal teacher actions', () => {
  it('keeps the final evaluation modal to save-only actions', () => {
    render(
      <EvaluationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        student={{ id: 'student-1', name: 'Final Student', contact: '0384072314' } as any}
        classData={{ id: 'class-1', name: 'Class A' } as any}
        formData={{
          evaluationType: 'final',
          rank: 'none',
          scores: {
            attendance: 5,
            effort: 5,
            pronunciation: 5,
            homework: 5,
            behavior: 5,
          },
          finalScore: 9,
          positivePoints: 'Good speaking',
          improvementPoints: 'Needs more writing',
        }}
        setFormData={vi.fn()}
        isSaving={false}
        editingEvalId={null}
        onSendZaloEvaluation={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Save Record/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Send via Zalo/i })).toBeNull();
  });

  it('lets teachers select an evaluation rank', () => {
    const setFormData = vi.fn();
    const formData = {
      evaluationType: 'final' as const,
      rank: 'none' as const,
      scores: {
        attendance: 5,
        effort: 5,
        pronunciation: 5,
        homework: 5,
        behavior: 5,
      },
      finalScore: 9,
      positivePoints: 'Good speaking',
      improvementPoints: 'Needs more writing',
    };

    render(
      <EvaluationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        student={{ id: 'student-1', name: 'Final Student', contact: '0384072314' } as any}
        classData={{ id: 'class-1', name: 'Class A' } as any}
        formData={formData}
        setFormData={setFormData}
        isSaving={false}
        editingEvalId={null}
      />
    );

    expect(screen.getByText('Rank')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /First Prize/i }));

    expect(setFormData).toHaveBeenCalledWith({
      ...formData,
      rank: 'first',
    });
  });
});
