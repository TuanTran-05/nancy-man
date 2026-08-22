import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssessmentAnswer } from '../../../../shared/assignmentAssessment';
import {
  chooseNewestAssignmentAttemptDraft,
  type AssignmentAttemptDraft,
} from '../../../../shared/assignmentAttemptDraft';
import type { QuizAnswer } from '../../../types/academic';
import {
  clearAssignmentAttemptDraft,
  getAssignmentAttemptDraft,
  saveAssignmentAttemptDraft,
} from '../../../lib/api/assignmentAttemptDraftApi';

export type AttemptAutosaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

interface UseAssignmentAttemptAutosaveInput {
  enabled: boolean;
  assignmentId: string | null;
  studentId: string | null;
  content: string;
  quizAnswers: QuizAnswer[];
  assessmentAnswers: AssessmentAnswer[];
  onHydrate: (draft: Partial<AssignmentAttemptDraft>) => void;
}

function storageKey(assignmentId: string, studentId: string) {
  return `assignment-attempt-draft:${assignmentId}:${studentId}`;
}

function readLocalDraft(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<AssignmentAttemptDraft>) : null;
  } catch {
    return null;
  }
}

function buildInputSnapshot(
  content: string,
  quizAnswers: QuizAnswer[],
  assessmentAnswers: AssessmentAnswer[]
) {
  return {
    content,
    quizAnswersJson: JSON.stringify(quizAnswers),
    assessmentAnswersJson: JSON.stringify(assessmentAnswers),
  };
}

function inputSnapshotsMatch(
  left: ReturnType<typeof buildInputSnapshot>,
  right: ReturnType<typeof buildInputSnapshot>
) {
  return (
    left.content === right.content &&
    left.quizAnswersJson === right.quizAnswersJson &&
    left.assessmentAnswersJson === right.assessmentAnswersJson
  );
}

export function useAssignmentAttemptAutosave(input: UseAssignmentAttemptAutosaveInput) {
  const { enabled, assignmentId, studentId, content, quizAnswers, assessmentAnswers, onHydrate } =
    input;

  const [status, setStatus] = useState<AttemptAutosaveStatus>('idle');
  const [restoredDraft, setRestoredDraft] = useState(false);
  const hydratedKeyRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  const key = useMemo(
    () => (assignmentId && studentId ? storageKey(assignmentId, studentId) : null),
    [assignmentId, studentId]
  );
  const renderedInputSnapshot = buildInputSnapshot(content, quizAnswers, assessmentAnswers);

  const onHydrateRef = useRef(onHydrate);
  useEffect(() => {
    onHydrateRef.current = onHydrate;
  }, [onHydrate]);

  const clearedValuesRef = useRef<{
    content: string;
    quizAnswers: QuizAnswer[];
    assessmentAnswers: AssessmentAnswer[];
  } | null>(null);

  const shouldSyncRef = useRef(false);
  const currentInputsRef = useRef(renderedInputSnapshot);
  const inputVersionRef = useRef(0);
  const lastInputsRef = useRef(buildInputSnapshot('', [], []));

  if (!inputSnapshotsMatch(currentInputsRef.current, renderedInputSnapshot)) {
    inputVersionRef.current += 1;
    currentInputsRef.current = renderedInputSnapshot;
  }

  useEffect(() => {
    if (enabled) return;
    hydratedKeyRef.current = null;
    shouldSyncRef.current = false;
    clearedValuesRef.current = null;
    lastInputsRef.current = buildInputSnapshot('', [], []);
    setRestoredDraft(false);
    setStatus('idle');
  }, [enabled]);

  // Hydrate effect
  useEffect(() => {
    if (!enabled || !assignmentId || !studentId || !key) return;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    let active = true;

    async function hydrate() {
      setStatus('loading');
      const startedWithInputVersion = inputVersionRef.current;
      const localDraft = readLocalDraft(key);
      let serverDraft: AssignmentAttemptDraft | null = null;
      try {
        serverDraft = await getAssignmentAttemptDraft(assignmentId!);
      } catch (err) {
        setStatus('offline');
      }
      if (!active) return;
      if (inputVersionRef.current !== startedWithInputVersion) {
        setStatus((current) => (current === 'offline' ? 'offline' : 'idle'));
        return;
      }
      const newest = chooseNewestAssignmentAttemptDraft(localDraft, serverDraft);
      if (newest) {
        onHydrateRef.current(newest);
        setRestoredDraft(true);
        if (newest === localDraft) {
          shouldSyncRef.current = true;
        }
        // Initialize lastInputs with what was hydrated to prevent immediate re-save
        lastInputsRef.current = buildInputSnapshot(
          newest.content || '',
          newest.quizAnswers || [],
          newest.assessmentAnswers || []
        );
      }
      setStatus((current) => (current === 'offline' ? 'offline' : 'idle'));
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, [enabled, assignmentId, studentId, key]);

  // Save effect
  useEffect(() => {
    if (!enabled || !assignmentId || !studentId || !key) return;

    const inputSnapshot = buildInputSnapshot(content, quizAnswers, assessmentAnswers);

    const hasChanged =
      shouldSyncRef.current || !inputSnapshotsMatch(inputSnapshot, lastInputsRef.current);

    if (!hasChanged) return;
    shouldSyncRef.current = false;

    if (clearedValuesRef.current) {
      const clearedSnapshot = buildInputSnapshot(
        clearedValuesRef.current.content,
        clearedValuesRef.current.quizAnswers,
        clearedValuesRef.current.assessmentAnswers
      );
      const isSameAsCleared = inputSnapshotsMatch(inputSnapshot, clearedSnapshot);
      if (isSameAsCleared) {
        lastInputsRef.current = inputSnapshot;
        return;
      }
      clearedValuesRef.current = null;
    }

    lastInputsRef.current = inputSnapshot;

    const updatedAt = new Date().toISOString();
    const draft = {
      assignmentId,
      studentId,
      content,
      quizAnswers,
      assessmentAnswers,
      updatedAt,
    };
    window.localStorage.setItem(key, JSON.stringify(draft));

    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        setStatus('saving');
        await saveAssignmentAttemptDraft({
          assignmentId: assignmentId!,
          content,
          quizAnswers,
          assessmentAnswers,
          clientSavedAt: updatedAt,
        });
        setStatus('saved');
      } catch (err) {
        setStatus('offline');
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [enabled, assignmentId, studentId, content, quizAnswers, assessmentAnswers, key]);

  const clearDraft = useCallback(async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const emptyQuizAnswers: QuizAnswer[] = [];
    const emptyAssessmentAnswers: AssessmentAnswer[] = [];
    clearedValuesRef.current = {
      content: '',
      quizAnswers: emptyQuizAnswers,
      assessmentAnswers: emptyAssessmentAnswers,
    };
    lastInputsRef.current = buildInputSnapshot('', emptyQuizAnswers, emptyAssessmentAnswers);
    if (key) window.localStorage.removeItem(key);
    if (assignmentId) {
      await clearAssignmentAttemptDraft(assignmentId);
    }
    setRestoredDraft(false);
    setStatus('idle');
  }, [assignmentId, key, content, quizAnswers, assessmentAnswers]);

  return { status, restoredDraft, clearDraft };
}
