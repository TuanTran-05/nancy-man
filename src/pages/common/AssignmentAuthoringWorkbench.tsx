import { useEffect, useReducer, useRef, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import type { Class, UserProfile } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import {
  createInitialWorkbenchState,
  reducer,
  setDraftTitle,
} from '../../components/assignments/authoring/authoringState';
import {
  clearLocalDraft,
  isDraftNewer,
  isSupersededDraftSyncError,
  loadLocalDraft,
  saveLocalDraft,
  scheduleServerDraftSync,
} from '../../components/assignments/authoring/draftSync';
import {
  createQuestionBankItem,
  getAuthoringDraft,
  publishAuthoringDraft,
  saveAuthoringDraft,
} from '../../lib/api/assignmentAuthoringApi';
import toast from 'react-hot-toast';
import {
  getAuthoringValidationIssues,
  type AssignmentAuthoringDraft,
  type AuthoringValidationIssue,
} from '../../../shared/assignmentAuthoring';
import { readChannel } from '../../lib/api/readApi';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import {
  closePreview,
  createInitialAuthoringUiState,
  openPreview,
  setAuthoringActiveTab,
} from '../../components/assignments/authoring/authoringUiState';
import { AuthoringShell } from '../../components/assignments/authoring/AuthoringShell';
import { AuthoringHeader } from '../../components/assignments/authoring/AuthoringHeader';
import { AuthoringTabs } from '../../components/assignments/authoring/AuthoringTabs';
import { QuestionCanvas } from '../../components/assignments/authoring/QuestionCanvas';
import { FloatingInsertToolbar } from '../../components/assignments/authoring/FloatingInsertToolbar';
import { SettingsDrawer } from '../../components/assignments/authoring/SettingsDrawer';
import { ResponsesPanel } from '../../components/assignments/authoring/ResponsesPanel';
import { PreviewDrawer } from '../../components/assignments/authoring/PreviewDrawer';
import { QuestionBankDrawer } from '../../components/assignments/authoring/QuestionBankDrawer';
import { MediaPickerDialog } from '../../components/assignments/authoring/MediaPickerDialog';

interface AssignmentAuthoringWorkbenchProps {
  profile: UserProfile | null;
}

export default function AssignmentAuthoringWorkbench({
  profile,
}: AssignmentAuthoringWorkbenchProps) {
  const { draftId } = useParams();
  const { t } = useLanguage();
  const T = t.assignmentWorkbench;
  const [state, dispatch] = useReducer(
    reducer,
    profile?.uid || 'anonymous',
    createInitialWorkbenchState
  );
  const navigate = useNavigate();
  const [isPublishing, setIsPublishing] = useState(false);
  const [uiState, setUiState] = useState(createInitialAuthoringUiState);
  const selectedQuestion = useMemo(
    () =>
      state.draft.assessmentDraft.sections
        .flatMap((section) => section.questions)
        .find((question) => question.id === state.selectedQuestionId),
    [state.draft.assessmentDraft.sections, state.selectedQuestionId]
  );
  const [mediaPickerTarget, setMediaPickerTarget] = useState<{
    questionId: string;
    target: 'question' | { optionKey: string };
    mediaKind?: 'image' | 'audio' | 'video';
  } | null>(null);

  const openMediaPicker = (
    questionId: string,
    target: 'question' | { optionKey: string },
    mediaKind?: 'image' | 'audio' | 'video'
  ) => setMediaPickerTarget({ questionId, target, mediaKind });

  const saveDraftNow = async () => {
    dispatch({ type: 'set_sync_status', syncStatus: 'syncing' });
    try {
      const savedDraft = await saveAuthoringDraft<AssignmentAuthoringDraft>(state.draft);
      dispatch({ type: 'set_draft', draft: savedDraft });
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save draft');
      dispatch({ type: 'set_sync_status', syncStatus: 'offline' });
    }
  };

  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Array<{ id: string; name: string }>>([]);
  const [draftLoadError, setDraftLoadError] = useState('');
  const latestDraftRef = useRef(state.draft);
  const latestLocalRevisionRef = useRef(state.draft.localRevision);
  const hasPublishedRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const classFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    latestDraftRef.current = state.draft;
    latestLocalRevisionRef.current = state.draft.localRevision;
  }, [state.draft]);

  useEffect(() => {
    let active = true;
    readChannel<{ classes: Class[] }>('classes', { limit: 500 })
      .then((data) => {
        if (active) setClasses(data.classes || []);
      })
      .catch(() => {
        if (active) setClasses([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state.draft.classId) {
      setStudents([]);
      return;
    }
    let active = true;
    getStudentDirectory()
      .then((data) => {
        if (active) {
          const filtered = (data.students || [])
            .filter((student) => student.classId === state.draft.classId)
            .map((student) => ({ id: student.id, name: student.name || '' }));
          setStudents(filtered);
        }
      })
      .catch(() => {
        if (active) setStudents([]);
      });
    return () => {
      active = false;
    };
  }, [state.draft.classId]);

  useEffect(() => {
    if (!draftId) return;
    setDraftLoadError('');
    const localDraft = loadLocalDraft(draftId);
    const ownedLocalDraft = localDraft?.ownerUid === profile?.uid ? localDraft : null;
    if (ownedLocalDraft) dispatch({ type: 'set_draft', draft: ownedLocalDraft });

    let active = true;
    getAuthoringDraft<AssignmentAuthoringDraft>(draftId)
      .then((draft) => {
        if (!active) return;
        const latestDraft = latestDraftRef.current;
        const latestOwnedDraft =
          latestDraft.id === draftId && latestDraft.ownerUid === profile?.uid
            ? latestDraft
            : ownedLocalDraft;
        if (latestOwnedDraft && isDraftNewer(latestOwnedDraft, draft)) {
          dispatch({ type: 'set_sync_status', syncStatus: 'local_pending' });
          return;
        }
        dispatch({ type: 'set_draft', draft });
      })
      .catch((err) => {
        if (active) {
          if (ownedLocalDraft) {
            dispatch({ type: 'set_sync_status', syncStatus: 'local_pending' });
            return;
          }
          const message = err instanceof Error ? err.message : T.couldNotLoadDraft;
          setDraftLoadError(message);
          toast.error(message);
        }
      });
    return () => {
      active = false;
    };
  }, [draftId, profile?.uid]);

  const publishDraft = async () => {
    const issues = getAuthoringValidationIssues(state.draft);
    dispatch({ type: 'set_errors', errors: issues.map((issue) => issue.message) });
    if (issues.length > 0) {
      const firstQuestionIssue = issues.find((issue) => issue.sectionId || issue.questionId);
      if (firstQuestionIssue) {
        dispatch({ type: 'select_validation_issue', issue: firstQuestionIssue });
      }
      toast.error(issues[0].message);
      return;
    }

    setIsPublishing(true);
    try {
      dispatch({ type: 'set_sync_status', syncStatus: 'syncing' });
      const savedDraft = await saveAuthoringDraft<AssignmentAuthoringDraft>(state.draft);
      dispatch({ type: 'set_draft', draft: savedDraft });
      const assignmentId = await publishAuthoringDraft(savedDraft.id);
      hasPublishedRef.current = true;
      clearLocalDraft(savedDraft.id);
      toast.success(T.publishedSuccess.replace('{id}', assignmentId));
      navigate('/assignments');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : T.publishError);
    } finally {
      setIsPublishing(false);
    }
  };

  const saveQuestionToBank = async (questionId: string) => {
    const question = state.draft.assessmentDraft.sections
      .flatMap((section) => section.questions)
      .find((item) => item.id === questionId);
    if (!question) return;
    await createQuestionBankItem({
      skill: question.skill,
      responseMode: question.responseMode,
      prompt: question.prompt,
      media: question.media,
      options: question.options,
      points: question.points,
      level: question.level,
      tags: [],
      sourceQuestionId: question.id,
    });
    toast.success(T.savedToBankSuccess);
  };

  const handleReadinessIssueSelect = (issue: AuthoringValidationIssue) => {
    if (issue.sectionId || issue.questionId) {
      dispatch({ type: 'select_validation_issue', issue });
      setUiState((current) => ({ ...current, activeTab: 'questions', settingsOpen: false }));
      return;
    }
    if (issue.code === 'title_required') {
      const el = document.querySelector('[aria-label="Assignment title"]') as HTMLElement | null;
      el?.focus();
      return;
    }
    setUiState((current) => ({ ...current, activeTab: 'settings', settingsOpen: true }));
    setTimeout(() => {
      if (issue.code === 'class_required') {
        const el = document.querySelector('[aria-label="Class assignment"]') as HTMLElement | null;
        el?.focus();
      } else if (issue.code === 'due_date_required' || issue.code === 'due_date_invalid') {
        const el = document.querySelector('[aria-label="Due date"]') as HTMLElement | null;
        el?.focus();
      }
    }, 50);
  };

  useEffect(() => {
    if (!isPublishing && !hasPublishedRef.current) {
      saveLocalDraft(state.draft);
    }
    if (
      !isPublishing &&
      !hasPublishedRef.current &&
      state.syncStatus === 'local_pending' &&
      state.draft.title.trim()
    ) {
      const syncRevision = state.draft.localRevision;
      dispatch({ type: 'set_sync_status', syncStatus: 'syncing' });
      scheduleServerDraftSync(state.draft)
        .then((serverDraft) => {
          if (latestLocalRevisionRef.current === syncRevision) {
            dispatch({ type: 'set_draft', draft: { ...serverDraft, localRevision: syncRevision } });
          }
        })
        .catch((err) => {
          if (isSupersededDraftSyncError(err)) return;
          if (latestLocalRevisionRef.current === syncRevision) {
            const status =
              err && typeof err === 'object' && 'status' in err && err.status === 409
                ? 'conflict'
                : 'offline';
            dispatch({ type: 'set_sync_status', syncStatus: status });
          }
        });
    }
  }, [state.draft, state.syncStatus, isPublishing]);

  if (draftLoadError) {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
        <div className="mx-auto max-w-xl rounded-lg border border-red-200 bg-white p-6">
          <h1 className="text-xl font-black text-red-700">{T.couldNotLoadDraft}</h1>
          <p className="mt-2 text-sm font-medium text-slate-600">{draftLoadError}</p>
          <Link
            to="/assignments"
            className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white"
          >
            {T.backToAssignments}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AuthoringShell
      header={
        <AuthoringHeader
          title={state.draft.title}
          syncStatus={state.syncStatus}
          isPublishing={isPublishing}
          onTitleChange={(title) => dispatch(setDraftTitle(title))}
          onPreview={() => setUiState((current) => openPreview(current))}
          onSaveDraft={() => void saveDraftNow()}
          onPublish={() => void publishDraft()}
        />
      }
      tabs={
        <AuthoringTabs
          activeTab={uiState.activeTab}
          onChange={(activeTab) =>
            setUiState((current) => setAuthoringActiveTab(current, activeTab))
          }
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_4.5rem]">
        {uiState.activeTab === 'questions' ? (
          <QuestionCanvas
            state={state}
            dispatch={dispatch}
            onTitleChange={(title) => dispatch(setDraftTitle(title))}
            onDescriptionChange={(description) =>
              dispatch({ type: 'update_draft_fields', fields: { description } })
            }
            onSaveQuestionToBank={saveQuestionToBank}
            onOpenMediaPicker={(questionId, target) => openMediaPicker(questionId, target)}
          />
        ) : (
          <ResponsesPanel draft={state.draft} />
        )}
        <FloatingInsertToolbar
          mode={uiState.toolbarMode}
          onAddQuestion={() =>
            dispatch({ type: 'add_question', sectionId: state.selectedSectionId })
          }
          onAddSection={() =>
            dispatch({
              type: 'add_section',
              title: 'New section',
              skill: 'mixed',
              instructions: '',
            })
          }
          onOpenQuestionBank={() =>
            setUiState((current) => ({ ...current, questionBankOpen: true }))
          }
          onOpenMediaPicker={(mediaKind) => {
            if (selectedQuestion) openMediaPicker(selectedQuestion.id, 'question', mediaKind);
          }}
        />
      </div>
      <SettingsDrawer
        open={uiState.settingsOpen}
        draft={state.draft}
        classes={classes}
        students={students}
        isPublishing={isPublishing}
        onClose={() =>
          setUiState((current) => ({ ...current, settingsOpen: false, activeTab: 'questions' }))
        }
        onDraftFieldsChange={(fields) => dispatch({ type: 'update_draft_fields', fields })}
        onDeliveryPolicyChange={(deliveryPolicy) =>
          dispatch({ type: 'update_draft_fields', fields: { deliveryPolicy } })
        }
        onIssueSelect={handleReadinessIssueSelect}
        onPublish={() => void publishDraft()}
      />
      <QuestionBankDrawer
        open={uiState.questionBankOpen}
        onClose={() => setUiState((current) => ({ ...current, questionBankOpen: false }))}
        onInsert={(item) => {
          dispatch({ type: 'insert_bank_question', sectionId: state.selectedSectionId, item });
          setUiState((current) => ({ ...current, questionBankOpen: false }));
        }}
      />
      <MediaPickerDialog
        open={mediaPickerTarget !== null}
        classId={state.draft.classId}
        mediaKind={mediaPickerTarget?.mediaKind}
        onClose={() => setMediaPickerTarget(null)}
        onInsert={(item) => {
          if (mediaPickerTarget) {
            const { questionId, target } = mediaPickerTarget;
            if (typeof target === 'object' && 'optionKey' in target) {
              const optionKey = target.optionKey;
              const question = state.draft.assessmentDraft.sections
                .flatMap((s) => s.questions)
                .find((q) => q.id === questionId);
              if (question) {
                const optionMedia = question.optionMedia || {};
                const currentMedia = optionMedia[optionKey] || [];
                const nextMedia = [
                  ...currentMedia,
                  {
                    id: 'media-' + Math.random().toString(36).substr(2, 9),
                    type: item.type,
                    source: item.source,
                    url: item.url,
                    altText: item.altText,
                    title: item.title,
                  },
                ];
                dispatch({
                  type: 'update_question',
                  questionId: question.id,
                  question: {
                    ...question,
                    optionMedia: {
                      ...optionMedia,
                      [optionKey]: nextMedia,
                    },
                  },
                });
              }
            } else {
              dispatch({ type: 'insert_media', questionId, item });
            }
          }
          setMediaPickerTarget(null);
        }}
      />
      <PreviewDrawer
        draft={state.draft}
        open={uiState.previewOpen}
        device={uiState.previewDevice}
        onClose={() => setUiState((current) => closePreview(current))}
      />
    </AuthoringShell>
  );
}
