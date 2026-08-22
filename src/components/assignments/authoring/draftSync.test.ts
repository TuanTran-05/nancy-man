// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocalDraft, saveLocalDraft, scheduleServerDraftSync } from './draftSync';
import { createBlankAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { saveAuthoringDraft } from '../../../lib/api/assignmentAuthoringApi';

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  saveAuthoringDraft: vi.fn(),
}));

describe('draftSync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('saves and loads local drafts', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    saveLocalDraft(draft);
    expect(loadLocalDraft(draft.id)?.id).toBe(draft.id);
  });

  it('waits two seconds before syncing a draft', async () => {
    vi.useFakeTimers();
    const draft = createBlankAuthoringDraft('teacher-1');
    vi.mocked(saveAuthoringDraft).mockResolvedValue({ ...draft, serverRevision: 1 });

    const sync = scheduleServerDraftSync(draft);
    await vi.advanceTimersByTimeAsync(1999);
    expect(saveAuthoringDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(sync).resolves.toEqual(expect.objectContaining({ serverRevision: 1 }));
    expect(saveAuthoringDraft).toHaveBeenCalledWith(draft);
    vi.useRealTimers();
  });

  it('keeps only the latest scheduled sync for the same draft', async () => {
    const firstDraft = { ...createBlankAuthoringDraft('teacher-1'), id: 'draft-1', title: 'First' };
    const latestDraft = { ...firstDraft, title: 'Latest', localRevision: 2 };
    vi.mocked(saveAuthoringDraft).mockResolvedValue({ ...latestDraft, serverRevision: 1 });

    const first = scheduleServerDraftSync(firstDraft).catch((err) => err);
    const latest = scheduleServerDraftSync(latestDraft);

    vi.advanceTimersByTime(2000);
    await latest;
    await first;

    expect(saveAuthoringDraft).toHaveBeenCalledTimes(1);
    expect(saveAuthoringDraft).toHaveBeenCalledWith(latestDraft);
  });
});
