// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentOperationsPanel } from './AssignmentOperationsPanel';
import { getAssignmentProgressSummary } from '../../lib/api/assignmentOperationsApi';

vi.mock('../../lib/api/assignmentOperationsApi', () => ({
  getAssignmentProgressSummary: vi.fn(),
}));

describe('AssignmentOperationsPanel', () => {
  it('renders progress counts, missing students, manual queue, and exports csv', async () => {
    vi.mocked(getAssignmentProgressSummary).mockResolvedValue({
      counts: { target: 3, submitted: 2, graded: 1, missing: 1, late: 1, pendingManual: 1 },
      missingStudents: [{ id: 'student-3', name: 'Student Three' }],
      manualGradingQueue: [
        { id: 'sub-2', studentName: 'Student Two', submittedAt: '2026-06-12T11:00:00.000Z' },
      ],
      lateSubmissions: [
        { id: 'sub-2', studentName: 'Student Two', submittedAt: '2026-06-12T11:00:00.000Z' },
      ],
    });
    const createObjectURL = vi.fn().mockReturnValue('blob:progress');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    render(<AssignmentOperationsPanel assignmentId="assignment-1" onClose={vi.fn()} />);

    expect(await screen.findByText('3 target')).toBeInTheDocument();
    expect(screen.getByText('Student Three')).toBeInTheDocument();
    expect(screen.getAllByText('Student Two')[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export progress CSV' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
});
