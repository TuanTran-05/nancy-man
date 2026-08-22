// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCourseFeeLedgers, type CourseFeeLedgerRun } from '../../../lib/api/classAdminApi';
import type { Student } from '../../../types';
import { GenerateLedgersDialog } from './GenerateLedgersDialog';

vi.mock('../../../lib/api/classAdminApi', () => ({
  runCourseFeeLedgers: vi.fn(),
}));

const emptyRun = {
  mode: 'preview' as const,
  createdCount: 0,
  skippedDuplicates: 0,
  skippedClasses: 0,
  processedClasses: 0,
  totalAmount: 0,
  plan: [],
  duplicateLedgers: [],
  errors: [],
  pages: 1,
};

describe('GenerateLedgersDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders through the standard centered modal portal layer', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue(emptyRun);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { container, unmount } = render(
      <GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />,
      { container: host }
    );

    const dialog = await screen.findByRole('dialog', {
      name: /Tạo công nợ toàn trung tâm/i,
    });
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement).toHaveClass(
      'fixed',
      'inset-0',
      'z-[1000]',
      'items-center',
      'justify-center'
    );
    expect(screen.getByTestId('generate-ledgers-backdrop')).toHaveClass(
      'bg-slate-950/50',
      'backdrop-blur-sm'
    );

    unmount();
    host.remove();
  });

  it('closes with Escape while no write or nested dialog is active', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue(emptyRun);
    const onClose = vi.fn();
    render(<GenerateLedgersDialog open onClose={onClose} onApplied={vi.fn()} />);

    await screen.findByRole('dialog', { name: /Tạo công nợ toàn trung tâm/i });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets a nested modal own Escape', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue(emptyRun);
    const onClose = vi.fn();
    render(<GenerateLedgersDialog open onClose={onClose} onApplied={vi.fn()} />);
    await screen.findByRole('dialog', { name: /Tạo công nợ toàn trung tâm/i });

    const nestedDialog = document.createElement('div');
    nestedDialog.setAttribute('role', 'dialog');
    nestedDialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(nestedDialog);
    fireEvent.keyDown(document, { key: 'Escape' });
    nestedDialog.remove();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked while idle', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue(emptyRun);
    const onClose = vi.fn();
    render(<GenerateLedgersDialog open onClose={onClose} onApplied={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole('button', {
        name: /Đóng: Tạo công nợ toàn trung tâm/i,
      })
    );

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('previews on open and shows the per-class breakdown', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      createdCount: 2,
      totalAmount: 1_800_000,
      plan: [
        {
          classId: 'c1',
          className: 'G3 Alpha',
          tuitionFee: 900_000,
          skipReason: null,
          creates: [
            { studentId: 's1', amount: 900_000 },
            { studentId: 's2', amount: 900_000 },
          ],
          alreadyExists: 1,
        },
      ],
    });

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    await screen.findByText('G3 Alpha');
    expect(runCourseFeeLedgers).toHaveBeenCalledWith('preview', expect.anything());
    expect(runCourseFeeLedgers).toHaveBeenCalledTimes(1);
  });

  it('keeps the heading and actions outside the scrolling preview content', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      createdCount: 1,
      plan: [
        {
          classId: 'c1',
          className: 'G3 Alpha',
          tuitionFee: 900_000,
          skipReason: null,
          creates: [{ studentId: 's1', amount: 900_000 }],
          alreadyExists: 0,
        },
      ],
    });

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    await screen.findByText('G3 Alpha');
    const scrollRegion = screen.getByTestId('generate-ledgers-scroll-region');
    expect(scrollRegion).toContainElement(screen.getByRole('table'));
    expect(scrollRegion).not.toContainElement(screen.getByRole('heading', { level: 2 }));
    screen
      .getAllByRole('button')
      .forEach((button) => expect(scrollRegion).not.toContainElement(button));
  });

  it('counts each student once when their classes span two pages', async () => {
    const classRow = (classId: string, studentId: string) => ({
      classId,
      className: `Class ${classId}`,
      tuitionFee: 900_000,
      skipReason: null,
      creates: [{ studentId, amount: 900_000 }],
      alreadyExists: 0,
    });
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      createdCount: 2,
      totalAmount: 1_800_000,
      plan: [classRow('c1', 's1'), classRow('c2', 's1')],
    });

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    await screen.findByText('Class c1');
    const students = screen.getByText('Học sinh').parentElement;
    expect(students).toHaveTextContent('1');
    const classes = screen.getAllByText('Lớp')[0].parentElement;
    expect(classes).toHaveTextContent('2');
  });

  it('disables confirmation when nothing would be created', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue(emptyRun);

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    const confirm = await screen.findByRole('button', { name: /Xác nhận tạo/i });
    expect(confirm).toBeDisabled();
  });

  it('lists every pre-existing duplicate row, not just a count', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      duplicateLedgers: [
        { classId: 'c1', studentId: 's1', termStart: '2026-01-05', ledgerIds: ['a', 'b'] },
        { classId: 'c2', studentId: 's9', termStart: '2026-02-01', ledgerIds: ['x', 'y'] },
      ],
    });

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    expect(await screen.findByText(/s1/)).toBeInTheDocument();
    expect(screen.getByText(/s9/)).toBeInTheDocument();
  });

  it('names the class and student behind each duplicate instead of raw ids', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      plan: [
        {
          classId: 'c1',
          className: 'G3 Alpha',
          tuitionFee: 900_000,
          skipReason: null,
          creates: [],
          alreadyExists: 2,
        },
      ],
      duplicateLedgers: [
        {
          classId: 'c1',
          studentId: 's1',
          termStart: '2026-07-24',
          ledgerIds: ['s1_c1_2026-07-24_2026-09-16', 's1_c1_2026-07-24_2026-09-18'],
        },
      ],
    });
    const studentMap = {
      s1: {
        id: 's1',
        name: 'Trần Minh',
        studentId: 's1',
        dob: '',
        contact: '',
        classId: 'c1',
        teacherId: '',
        createdAt: '2026-07-24T00:00:00.000Z',
        code: 'HS001',
      } satisfies Student,
    };

    render(
      <GenerateLedgersDialog open studentMap={studentMap} onClose={vi.fn()} onApplied={vi.fn()} />
    );

    expect(await screen.findByText('Trần Minh')).toBeInTheDocument();
    expect(screen.getByText(/HS001/)).toBeInTheDocument();
    expect(screen.getAllByText(/G3 Alpha/).length).toBeGreaterThan(0);
    // The repeated `{student}_{class}_{termStart}` head is dropped; the term end
    // that actually separates the two copies stays.
    const ids = screen.getByText('…_2026-09-16 · …_2026-09-18');
    expect(ids).toHaveAttribute(
      'title',
      's1_c1_2026-07-24_2026-09-16\ns1_c1_2026-07-24_2026-09-18'
    );
  });

  it('lists errors with their class and message', async () => {
    vi.mocked(runCourseFeeLedgers).mockResolvedValue({
      ...emptyRun,
      errors: [{ classId: 'c7', message: 'read failed' }],
    });

    render(<GenerateLedgersDialog open onClose={vi.fn()} onApplied={vi.fn()} />);

    expect(await screen.findByText(/read failed/)).toBeInTheDocument();
  });

  it('applies only after confirmation and reports the run back', async () => {
    const applied = { ...emptyRun, mode: 'apply' as const, createdCount: 2 };
    vi.mocked(runCourseFeeLedgers)
      .mockResolvedValueOnce({ ...emptyRun, createdCount: 2, totalAmount: 1_800_000 })
      .mockResolvedValueOnce(applied);
    const onApplied = vi.fn();
    const onClose = vi.fn();

    render(<GenerateLedgersDialog open onClose={onClose} onApplied={onApplied} />);

    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận tạo/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied));
    expect(runCourseFeeLedgers).toHaveBeenNthCalledWith(2, 'apply', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when the apply run reports errors', async () => {
    vi.mocked(runCourseFeeLedgers)
      .mockResolvedValueOnce({ ...emptyRun, createdCount: 2 })
      .mockResolvedValueOnce({
        ...emptyRun,
        mode: 'apply' as const,
        createdCount: 1,
        errors: [{ classId: 'c7', message: 'chunk rejected' }],
      });
    const onClose = vi.fn();

    render(<GenerateLedgersDialog open onClose={onClose} onApplied={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận tạo/i }));

    await screen.findByText(/chunk rejected/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks every dismissal path while the write is in flight', async () => {
    let releaseApply: (run: CourseFeeLedgerRun) => void = () => {};
    vi.mocked(runCourseFeeLedgers)
      .mockResolvedValueOnce({ ...emptyRun, createdCount: 2 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseApply = resolve as typeof releaseApply;
          })
      );
    const onClose = vi.fn();

    render(<GenerateLedgersDialog open onClose={onClose} onApplied={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận tạo/i }));

    const closeButton = await screen.findByRole('button', { name: /^Đóng$/i });
    const backdrop = screen.getByRole('button', {
      name: /Đóng: Tạo công nợ toàn trung tâm/i,
    });
    expect(closeButton).toBeDisabled();
    expect(backdrop).toBeDisabled();

    fireEvent.click(closeButton);
    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    releaseApply({ ...emptyRun, mode: 'apply', createdCount: 2 });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not preview while closed', () => {
    render(<GenerateLedgersDialog open={false} onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(runCourseFeeLedgers).not.toHaveBeenCalled();
  });
});
