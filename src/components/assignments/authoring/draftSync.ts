import type { AssignmentAuthoringDraft } from '../../../../shared/assignmentAuthoring';
import { saveAuthoringDraft } from '../../../lib/api/assignmentAuthoringApi';

const LOCAL_PREFIX = 'assignment-authoring-draft:';
const SUPERSEDED_SYNC_MESSAGE = 'Draft sync superseded';

const pendingSyncs = new Map<string, { timer: number; reject: (reason?: unknown) => void }>();

export function isSupersededDraftSyncError(err: unknown) {
  return err instanceof Error && err.message === SUPERSEDED_SYNC_MESSAGE;
}

export function getLocalDraftStorageKey(id: string) {
  return `${LOCAL_PREFIX}${id}`;
}

export function saveLocalDraft(draft: AssignmentAuthoringDraft) {
  localStorage.setItem(getLocalDraftStorageKey(draft.id), JSON.stringify(draft));
}

export function loadLocalDraft(id: string): AssignmentAuthoringDraft | null {
  const raw = localStorage.getItem(getLocalDraftStorageKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AssignmentAuthoringDraft;
  } catch {
    localStorage.removeItem(getLocalDraftStorageKey(id));
    return null;
  }
}

export function clearLocalDraft(id: string) {
  localStorage.removeItem(getLocalDraftStorageKey(id));
}

function draftTimestamp(draft: AssignmentAuthoringDraft) {
  const timestamp = Date.parse(draft.updatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isDraftNewer(
  candidate: AssignmentAuthoringDraft,
  current: AssignmentAuthoringDraft
) {
  const candidateRevision = Number(candidate.localRevision || 0);
  const currentRevision = Number(current.localRevision || 0);
  if (candidateRevision !== currentRevision) return candidateRevision > currentRevision;
  return draftTimestamp(candidate) > draftTimestamp(current);
}

export function listLocalDrafts() {
  const drafts: AssignmentAuthoringDraft[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(LOCAL_PREFIX)) continue;
    const draft = loadLocalDraft(key.slice(LOCAL_PREFIX.length));
    if (draft?.status === 'draft') drafts.push(draft);
  }
  return drafts.sort((left, right) => draftTimestamp(right) - draftTimestamp(left));
}

export function scheduleServerDraftSync(draft: AssignmentAuthoringDraft) {
  const existing = pendingSyncs.get(draft.id);
  if (existing) {
    window.clearTimeout(existing.timer);
    existing.reject(new Error(SUPERSEDED_SYNC_MESSAGE));
  }

  return new Promise<AssignmentAuthoringDraft>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingSyncs.delete(draft.id);
      saveAuthoringDraft<any>(draft).then(resolve).catch(reject);
    }, 2000);
    pendingSyncs.set(draft.id, { timer, reject });
  });
}
