// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SiblingSection } from './SiblingSection';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../../lib/api/apiClient', () => ({ apiRequest }));

const base = { studentLifecycle: 'enrolled', enrollmentStatus: 'active', classId: 'c1' };
const an = { ...base, id: 'an', name: 'An', studentId: 'HS001', siblingGroupId: 'g1' };
const binh = { ...base, id: 'binh', name: 'Binh', studentId: 'HS002', siblingGroupId: 'g1' };
const solo = { ...base, id: 'solo', name: 'Solo', studentId: 'HS003' };

describe('SiblingSection', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    vi.restoreAllMocks();
    localStorage.setItem('language', 'vi');
  });

  it('lists the sibling and reports the scholarship as in effect', () => {
    render(
      <SiblingSection
        student={an as any}
        siblings={[binh as any]}
        candidates={[]}
        canEdit={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText('Binh')).toBeTruthy();
    expect(screen.getByText(/đang có hiệu lực|in effect/i)).toBeTruthy();
  });

  it('explains why the scholarship is off when the sibling is archived', () => {
    const archived = { ...binh, studentLifecycle: 'archived' };
    render(
      <SiblingSection
        student={an as any}
        siblings={[archived as any]}
        candidates={[]}
        canEdit={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText(/không còn anh em|no sibling is currently/i)).toBeTruthy();
  });

  it('shows the empty state for an unlinked student', () => {
    render(
      <SiblingSection
        student={solo as any}
        siblings={[]}
        candidates={[]}
        canEdit={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getAllByText(/chưa gán|no sibling link/i).length).toBeGreaterThan(0);
  });

  it('hides editing controls when the viewer cannot edit', () => {
    render(
      <SiblingSection
        student={an as any}
        siblings={[binh as any]}
        candidates={[solo as any]}
        canEdit={false}
        onChanged={() => {}}
      />
    );
    expect(screen.queryByPlaceholderText(/tìm học sinh|search students/i)).toBeNull();
  });

  it('posts an object body, never a pre-stringified one', async () => {
    apiRequest.mockResolvedValueOnce({ success: true });
    const onChanged = vi.fn();
    render(
      <SiblingSection
        student={an as any}
        siblings={[]}
        candidates={[solo as any]}
        canEdit
        onChanged={onChanged}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/tìm học sinh|search students/i), {
      target: { value: 'Solo' },
    });
    fireEvent.click(await screen.findByText(/Solo/));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, options] = apiRequest.mock.calls[0];
    expect(typeof options.body).toBe('object');
    expect(options.body).toMatchObject({ op: 'link', studentId: 'an', siblingId: 'solo' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('lets an unlinked student select another unlinked student', async () => {
    apiRequest.mockResolvedValueOnce({ success: true });
    render(
      <SiblingSection
        student={solo as any}
        siblings={[]}
        candidates={[{ ...an, siblingGroupId: undefined } as any]}
        canEdit
        onChanged={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/tìm học sinh|search students/i), {
      target: { value: 'An' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /An/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/students/siblings', {
        method: 'POST',
        body: { op: 'link', studentId: 'solo', siblingId: 'an' },
      })
    );
  });

  it('retries with confirmMerge after the user confirms a merge', async () => {
    apiRequest
      .mockRejectedValueOnce(
        Object.assign(new Error('merge_confirmation_required'), { status: 409 })
      )
      .mockResolvedValueOnce({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <SiblingSection
        student={an as any}
        siblings={[]}
        candidates={[solo as any]}
        canEdit
        onChanged={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/tìm học sinh|search students/i), {
      target: { value: 'Solo' },
    });
    fireEvent.click(await screen.findByText(/Solo/));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(apiRequest.mock.calls[1][1].body).toMatchObject({ confirmMerge: true });
  });

  it('offers unlink only when the student has a group', () => {
    const { rerender } = render(
      <SiblingSection
        student={an as any}
        siblings={[binh as any]}
        candidates={[]}
        canEdit
        onChanged={() => {}}
      />
    );
    expect(screen.getByText(/gỡ khỏi nhóm|remove from group/i)).toBeTruthy();

    rerender(
      <SiblingSection
        student={solo as any}
        siblings={[]}
        candidates={[]}
        canEdit
        onChanged={() => {}}
      />
    );
    expect(screen.queryByText(/gỡ khỏi nhóm|remove from group/i)).toBeNull();
  });
});
