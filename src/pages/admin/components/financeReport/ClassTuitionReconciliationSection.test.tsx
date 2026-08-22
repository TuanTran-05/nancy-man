// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../../../../lib/api/financeApi', () => ({
  fetchClassReconciliationOptions: vi.fn(),
  fetchClassTuitionReconciliation: vi.fn(),
  fetchClassTuitionStudentDetail: vi.fn(),
}));

import {
  fetchClassReconciliationOptions,
  fetchClassTuitionReconciliation,
  fetchClassTuitionStudentDetail,
} from '../../../../lib/api/financeApi';
import { ClassTuitionReconciliationSection } from './ClassTuitionReconciliationSection';
import { translations } from '../../../../lib/i18n/translations';
import type { ClassTuitionReconciliationText } from './types';
import type {
  ClassReconciliationCourseOption,
  ClassReconciliationOptionsResponse,
  ClassTuitionReconciliationResponse,
} from '../../../../../shared/classTuitionReconciliation';

const t = translations.vi.adminFinanceReport.classReconciliation as ClassTuitionReconciliationText;

const optionsMock = vi.mocked(fetchClassReconciliationOptions);
const reportMock = vi.mocked(fetchClassTuitionReconciliation);
const detailMock = vi.mocked(fetchClassTuitionStudentDetail);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CLASSES: ClassReconciliationOptionsResponse = {
  success: true,
  mode: 'classes',
  classes: [
    {
      id: 'c1',
      name: 'Tiếng Anh 1A',
      status: 'active',
      teacherId: 't1',
      teacherName: 'Nguyễn Văn A',
    },
    { id: 'c2', name: 'Toán 2B', status: 'paused', teacherId: 't2', teacherName: 'Trần Thị B' },
  ],
};

function course(
  overrides: Partial<ClassReconciliationCourseOption> = {}
): ClassReconciliationCourseOption {
  return {
    key: 'c1:2026-06-01',
    courseId: null,
    termStart: '2026-06-01',
    termEnd: '2026-08-31',
    label: 'Khóa Hè 2026',
    isCurrent: true,
    warnings: [],
    tuitionFee: 2_000_000,
    tuitionFeeSource: 'class_current',
    ...overrides,
  };
}

function coursesResponse(
  courses: ClassReconciliationCourseOption[]
): ClassReconciliationOptionsResponse {
  return {
    success: true,
    mode: 'courses',
    selectedClass: {
      id: 'c1',
      name: 'Tiếng Anh 1A',
      status: 'active',
      teacherId: 't1',
      teacherName: 'Nguyễn Văn A',
    },
    warnings: [],
    courses,
  };
}

function reportResponse(
  overrides: Partial<ClassTuitionReconciliationResponse> = {}
): ClassTuitionReconciliationResponse {
  return {
    success: true,
    scope: {
      classId: 'c1',
      className: 'Tiếng Anh 1A',
      courseId: null,
      termStart: '2026-06-01',
      termEnd: '2026-08-31',
      courseLabel: 'Khóa Hè 2026',
    },
    tuitionFee: { amount: 2_000_000, source: 'class_current' },
    summary: {
      expectedGross: 2_000_000,
      recordedGross: 2_000_000,
      reductionTotal: 0,
      netDueTotal: 2_000_000,
      paidTotal: 2_000_000,
      outstandingTotal: 0,
      overpaidTotal: 0,
      studentCount: 1,
      unidentifiedLedgerCount: 0,
      missingLedgerCount: 0,
      warningRowCount: 0,
    },
    rows: [
      {
        key: 'student:st1',
        kind: 'student',
        studentId: 'st1',
        fullName: 'Nguyễn Văn An',
        studentCode: 'HV001',
        studentRecordFound: true,
        enrollmentIds: ['e1'],
        enrollmentStatuses: ['active'],
        ledgerIds: ['l1'],
        chargeable: true,
        expectedGross: 2_000_000,
        recordedGross: 2_000_000,
        reductionTotal: 0,
        netDueTotal: 2_000_000,
        paidTotal: 2_000_000,
        outstandingTotal: 0,
        overpaidTotal: 0,
        warnings: [],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function renderSection() {
  return render(<ClassTuitionReconciliationSection language="vi" t={t} />);
}

async function classCombobox(): Promise<HTMLInputElement> {
  const input = (await screen.findByLabelText(t.classLabel)) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

/**
 * The class listbox is scoped explicitly: the course `<select>` also exposes its
 * children as options, so an unscoped option query would count both lists.
 */
function classOptionLabels(): string[] {
  const listbox = screen.queryByRole('listbox');
  if (!listbox) return [];
  return within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent || '');
}

/**
 * Selects by class id, not by label: the option label carries the teacher name and
 * class status, so matching on the class name alone breaks whenever that format moves.
 */
async function selectClass(user: ReturnType<typeof userEvent.setup>, classId: string) {
  await user.click(await classCombobox());
  await user.click(await screen.findByTestId(`class-option:${classId}`));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClassTuitionReconciliationSection classes and courses', () => {
  it('loads only the class list on mount', async () => {
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    await waitFor(() => expect(optionsMock).toHaveBeenCalledTimes(1));
    expect(optionsMock).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('starts with no class selected and the list closed', async () => {
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    const input = await classCombobox();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe(t.classSearch);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps the course select disabled until a class is chosen', async () => {
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    const courseSelect = (await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement;
    expect(courseSelect.disabled).toBe(true);
  });

  it('narrows the class options on every keystroke in the same box', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    await user.click(await classCombobox());
    expect(classOptionLabels()).toHaveLength(2);

    await user.keyboard('toan');
    expect(classOptionLabels()).toHaveLength(1);
  });

  it('labels every class option with its teacher and class status', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    await user.click(await classCombobox());

    expect(classOptionLabels()).toEqual([
      `Tiếng Anh 1A - Nguyễn Văn A · ${t.classStatusLabels.active}`,
      `Toán 2B - Trần Thị B · ${t.classStatusLabels.paused}`,
    ]);
  });

  it('falls back to the shared GV placeholder when the teacher doc is gone, and drops it when the class has no teacher', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue({
      success: true,
      mode: 'classes',
      classes: [
        { id: 'c3', name: 'Văn 8A', status: 'archived', teacherId: 't-gone', teacherName: '' },
        { id: 'c4', name: 'Tự học', status: 'active', teacherId: '', teacherName: '' },
      ],
    });
    renderSection();

    await user.click(await classCombobox());

    expect(classOptionLabels()).toEqual([
      `Văn 8A - GV · ${t.classStatusLabels.archived}`,
      `Tự học · ${t.classStatusLabels.active}`,
    ]);
  });

  it('matches the class search against the teacher name too', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    await user.click(await classCombobox());
    // Unaccented, lowercase: the same normalization the class-name search already uses.
    await user.keyboard('tran thi b');

    expect(classOptionLabels()).toEqual([`Toán 2B - Trần Thị B · ${t.classStatusLabels.paused}`]);
  });

  it('says so when no class matches the query', async () => {
    const user = userEvent.setup();
    optionsMock.mockResolvedValue(CLASSES);
    renderSection();

    await user.click(await classCombobox());
    await user.keyboard('khong co lop nao');

    expect(classOptionLabels()).toEqual([]);
    expect(screen.getByText(t.noClassMatches)).toBeTruthy();
  });

  it('shows the chosen class in the box once the list closes', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c2');

    const input = await classCombobox();
    expect(input.value).toBe(`Toán 2B - Trần Thị B · ${t.classStatusLabels.paused}`);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps the loaded report while a new query is being typed', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByTestId('class-reconciliation-kpis')).toBeTruthy();

    await user.click(await classCombobox());
    await user.keyboard('khong co lop nao');

    expect(screen.getByTestId('class-reconciliation-kpis')).toBeTruthy();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it('drops the class and its report from the clear button', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByTestId('class-reconciliation-kpis')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: t.clearClass }));

    expect(screen.queryByTestId('class-reconciliation-kpis')).toBeNull();
    expect((await classCombobox()).value).toBe('');
    expect(((await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement).disabled).toBe(
      true
    );
  });

  it('loads courses for the chosen class and auto-selects the single current course', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId
        ? coursesResponse([
            course(),
            course({
              key: 'c1:2026-01-01',
              termStart: '2026-01-01',
              label: 'Khóa Xuân 2026',
              isCurrent: false,
            }),
          ])
        : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c1');

    await waitFor(() => expect(optionsMock).toHaveBeenCalledWith('c1', expect.any(AbortSignal)));
    const courseSelect = (await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement;
    await waitFor(() => expect(courseSelect.value).toBe('2026-06-01'));
  });

  it('does not guess a course when none is marked current', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId
        ? coursesResponse([
            course({ isCurrent: false }),
            course({ key: 'c1:2026-01-01', termStart: '2026-01-01', isCurrent: false }),
          ])
        : CLASSES
    );
    renderSection();

    await selectClass(user, 'c1');

    const courseSelect = (await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement;
    await waitFor(() => expect(courseSelect.disabled).toBe(false));
    expect(courseSelect.value).toBe('');
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('reports a class with no discoverable course', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([]) : CLASSES
    );
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByText(t.noCourses)).toBeTruthy();
  });
});

describe('ClassTuitionReconciliationSection report requests', () => {
  it('requests the report for the selected class and course', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c1');

    await waitFor(() =>
      expect(reportMock).toHaveBeenCalledWith({
        classId: 'c1',
        termStart: '2026-06-01',
        signal: expect.any(AbortSignal),
      })
    );
    expect(await screen.findByTestId('class-reconciliation-kpis')).toBeTruthy();
  });

  it('drops a course response that arrives after the class changed', async () => {
    const user = userEvent.setup();
    const slowC1 = deferred<ClassReconciliationOptionsResponse>();
    optionsMock.mockImplementation(async (classId?: string) => {
      if (!classId) return CLASSES;
      if (classId === 'c1') return slowC1.promise;
      return coursesResponse([
        course({
          key: 'c2:2026-07-01',
          termStart: '2026-07-01',
          label: 'Khóa C2',
          isCurrent: true,
        }),
      ]);
    });
    reportMock.mockResolvedValue(reportResponse());
    renderSection();

    await selectClass(user, 'c1');
    await selectClass(user, 'c2');

    const courseSelect = (await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement;
    await waitFor(() => expect(courseSelect.value).toBe('2026-07-01'));

    slowC1.resolve(coursesResponse([course()]));
    await Promise.resolve();

    expect(courseSelect.value).toBe('2026-07-01');
    expect(within(courseSelect).queryByRole('option', { name: /Khóa Hè 2026/ })).toBeNull();
  });

  it('drops a report response that arrives after the scope changed', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId
        ? coursesResponse([
            course(),
            course({
              key: 'c1:2026-01-01',
              termStart: '2026-01-01',
              label: 'Khóa Xuân 2026',
              isCurrent: false,
            }),
          ])
        : CLASSES
    );

    const slowFirst = deferred<ClassTuitionReconciliationResponse>();
    reportMock.mockImplementation(async ({ termStart }) =>
      termStart === '2026-06-01'
        ? slowFirst.promise
        : reportResponse({
            summary: { ...reportResponse().summary, paidTotal: 7_000_000 },
          })
    );

    renderSection();
    await selectClass(user, 'c1');
    const courseSelect = (await screen.findByLabelText(t.courseLabel)) as HTMLSelectElement;
    await waitFor(() => expect(courseSelect.value).toBe('2026-06-01'));

    await user.selectOptions(courseSelect, '2026-01-01');
    const kpis = await screen.findByTestId('class-reconciliation-kpis');
    expect(within(kpis).getByText('7.000.000 đ')).toBeTruthy();

    slowFirst.resolve(reportResponse());
    await Promise.resolve();
    await Promise.resolve();

    // the stale 2.000.000 "paid" total must not land on top of the current scope
    expect(within(kpis).getByText(t.kpis.paidTotal).parentElement?.textContent).toContain(
      '7.000.000 đ'
    );
  });

  it('clears the previous report the moment the scope changes', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId
        ? coursesResponse([
            course(),
            course({
              key: 'c1:2026-01-01',
              termStart: '2026-01-01',
              label: 'Khóa Xuân 2026',
              isCurrent: false,
            }),
          ])
        : CLASSES
    );
    const slowSecond = deferred<ClassTuitionReconciliationResponse>();
    reportMock.mockImplementation(async ({ termStart }) =>
      termStart === '2026-06-01' ? reportResponse() : slowSecond.promise
    );

    renderSection();
    await selectClass(user, 'c1');
    expect(await screen.findByTestId('class-reconciliation-kpis')).toBeTruthy();

    await user.selectOptions(await screen.findByLabelText(t.courseLabel), '2026-01-01');

    expect(screen.queryByTestId('class-reconciliation-kpis')).toBeNull();
    expect(screen.getByText(t.loadingReport)).toBeTruthy();
  });

  it('surfaces a report error with a retry that only refetches the report', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockRejectedValueOnce(new Error('boom'));
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByText('boom')).toBeTruthy();

    const optionCallsBefore = optionsMock.mock.calls.length;
    reportMock.mockResolvedValueOnce(reportResponse());
    await user.click(screen.getByRole('button', { name: t.retry }));

    expect(await screen.findByTestId('class-reconciliation-kpis')).toBeTruthy();
    expect(optionsMock.mock.calls.length).toBe(optionCallsBefore);
    expect(reportMock).toHaveBeenCalledTimes(2);
  });

  it('maps a 413 into the too-large message', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    const tooLarge = Object.assign(new Error('nope'), {
      errorCode: 'class_reconciliation_too_large',
      status: 413,
    });
    reportMock.mockRejectedValue(tooLarge);
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByText(t.tooLarge)).toBeTruthy();
  });

  it('renders the empty-course state without inventing totals', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(
      reportResponse({
        rows: [],
        summary: {
          expectedGross: 0,
          recordedGross: 0,
          reductionTotal: 0,
          netDueTotal: 0,
          paidTotal: 0,
          outstandingTotal: 0,
          overpaidTotal: 0,
          studentCount: 0,
          unidentifiedLedgerCount: 0,
          missingLedgerCount: 0,
          warningRowCount: 0,
        },
      })
    );
    renderSection();

    await selectClass(user, 'c1');
    expect(await screen.findByText(t.noRows)).toBeTruthy();
  });
});

describe('ClassTuitionReconciliationSection student detail', () => {
  function stubDetail() {
    detailMock.mockResolvedValue({
      success: true,
      scope: { classId: 'c1', termStart: '2026-06-01', studentId: 'st1', ledgerId: null },
      student: {
        id: 'st1',
        fullName: 'Nguyễn Văn An',
        studentCode: 'HV001',
        recordFound: true,
      },
      enrollments: [],
      ledgers: [],
      allocations: [],
      warnings: [],
      workspaceUrl: null,
    });
  }

  it('opens the detail modal for the clicked row', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId ? coursesResponse([course()]) : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    stubDetail();
    renderSection();

    await selectClass(user, 'c1');
    await screen.findByTestId('class-reconciliation-kpis');

    await user.click(screen.getAllByRole('button', { name: `${t.viewDetails}: Nguyễn Văn An` })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label') || '').toContain('Nguyễn Văn An');
    await waitFor(() =>
      expect(detailMock).toHaveBeenCalledWith(
        expect.objectContaining({ classId: 'c1', termStart: '2026-06-01', studentId: 'st1' })
      )
    );
  });

  it('closes the detail modal when the scope changes', async () => {
    const user = userEvent.setup();
    optionsMock.mockImplementation(async (classId?: string) =>
      classId
        ? coursesResponse([
            course(),
            course({
              key: 'c1:2026-01-01',
              termStart: '2026-01-01',
              label: 'Khóa Xuân 2026',
              isCurrent: false,
            }),
          ])
        : CLASSES
    );
    reportMock.mockResolvedValue(reportResponse());
    stubDetail();
    renderSection();

    await selectClass(user, 'c1');
    await screen.findByTestId('class-reconciliation-kpis');
    await user.click(screen.getAllByRole('button', { name: `${t.viewDetails}: Nguyễn Văn An` })[0]);
    await screen.findByRole('dialog');

    await user.selectOptions(await screen.findByLabelText(t.courseLabel), '2026-01-01');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
