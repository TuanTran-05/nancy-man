import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { parseAuthoringDndId, questionDndId, sectionDndId } from './authoringDnd';
import type { ReactNode } from 'react';
import type { AuthoringAction, AuthoringWorkbenchState } from './authoringState';
import { AssignmentTitleCard } from './AssignmentTitleCard';
import { QuestionCard } from './QuestionCard';
import { SectionCard } from './SectionCard';
import type {
  AssessmentQuestionInput,
  AssessmentSectionInput,
} from '../../../../shared/assignmentAssessment';

interface QuestionCanvasProps {
  state: AuthoringWorkbenchState;
  dispatch: (action: AuthoringAction) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onSaveQuestionToBank: (questionId: string) => void;
  onOpenMediaPicker: (
    questionId: string,
    target: 'question' | { optionKey: string },
    mediaKind?: 'image' | 'audio' | 'video'
  ) => void;
}

export function QuestionCanvas({
  state,
  dispatch,
  onTitleChange,
  onDescriptionChange,
  onSaveQuestionToBank,
  onOpenMediaPicker,
}: QuestionCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        let activeId;
        let overId;
        try {
          activeId = parseAuthoringDndId(String(active.id));
          overId = parseAuthoringDndId(String(over.id));
        } catch {
          return;
        }
        if (activeId.kind === 'section' && overId.kind === 'section') {
          const index = state.draft.assessmentDraft.sections.findIndex(
            (item) => item.id === overId.sectionId
          );
          if (index >= 0)
            dispatch({ type: 'reorder_section', sectionId: activeId.sectionId, index });
          return;
        }
        if (activeId.kind === 'question' && overId.kind === 'question') {
          const section = state.draft.assessmentDraft.sections.find(
            (item) => item.id === overId.sectionId
          );
          const index = section?.questions.findIndex((item) => item.id === overId.questionId) ?? -1;
          if (index < 0) return;
          dispatch({
            type: 'reorder_question',
            questionId: activeId.questionId,
            destination: { sectionId: overId.sectionId, index },
          });
        }
      }}
    >
      <div
        id="authoring-questions-panel"
        role="tabpanel"
        aria-label="Questions"
        className="mx-auto max-w-3xl space-y-5"
      >
        <AssignmentTitleCard
          title={state.draft.title}
          description={state.draft.description || ''}
          onTitleChange={onTitleChange}
          onDescriptionChange={onDescriptionChange}
        />
        <SortableContext
          items={state.draft.assessmentDraft.sections.map((section) => sectionDndId(section.id))}
          strategy={verticalListSortingStrategy}
        >
          {state.draft.assessmentDraft.sections.map((section) => (
            <SortableSection
              key={section.id}
              section={section}
              onChange={(nextSection) =>
                dispatch({ type: 'update_section', sectionId: section.id, section: nextSection })
              }
              onAddQuestion={() => dispatch({ type: 'add_question', sectionId: section.id })}
            >
              <SortableContext
                items={section.questions.map((question) => questionDndId(section.id, question.id))}
                strategy={verticalListSortingStrategy}
              >
                {section.questions.map((question, index) => (
                  <SortableQuestion
                    key={question.id}
                    sectionId={section.id}
                    question={question}
                    index={index}
                    selected={state.selectedQuestionId === question.id}
                    onSelect={() =>
                      dispatch({ type: 'select_question', questionId: question.id, multi: false })
                    }
                    onChange={(nextQuestion) =>
                      dispatch({
                        type: 'update_question',
                        questionId: question.id,
                        question: nextQuestion,
                      })
                    }
                    onDuplicate={() =>
                      dispatch({ type: 'duplicate_question', questionId: question.id })
                    }
                    onDelete={() =>
                      dispatch({ type: 'delete_questions', questionIds: [question.id] })
                    }
                    onMoveUp={() =>
                      dispatch({ type: 'move_question', questionId: question.id, direction: 'up' })
                    }
                    onMoveDown={() =>
                      dispatch({
                        type: 'move_question',
                        questionId: question.id,
                        direction: 'down',
                      })
                    }
                    onSaveToBank={() => onSaveQuestionToBank(question.id)}
                    onOpenMediaPicker={(target, mediaKind) =>
                      onOpenMediaPicker(question.id, target, mediaKind)
                    }
                  />
                ))}
              </SortableContext>
            </SortableSection>
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}

interface SortableSectionProps {
  section: AssessmentSectionInput;
  onChange: (section: AssessmentSectionInput) => void;
  onAddQuestion: () => void;
  children: ReactNode;
}

function SortableSection({ section, onChange, onAddQuestion, children }: SortableSectionProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionDndId(section.id) });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`space-y-4 ${isDragging ? 'opacity-60' : ''}`}
    >
      <SectionCard
        section={section}
        onChange={onChange}
        onAddQuestion={onAddQuestion}
        dragHandle={{ attributes, listeners, setActivatorNodeRef }}
      />
      {children}
    </div>
  );
}

interface SortableQuestionProps {
  sectionId: string;
  question: AssessmentQuestionInput;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (question: AssessmentQuestionInput) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSaveToBank: () => void;
  onOpenMediaPicker: (
    target: 'question' | { optionKey: string },
    mediaKind?: 'image' | 'audio' | 'video'
  ) => void;
}

function SortableQuestion(props: SortableQuestionProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: questionDndId(props.sectionId, props.question.id) });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-60' : ''}
    >
      <QuestionCard {...props} dragHandle={{ attributes, listeners, setActivatorNodeRef }} />
    </div>
  );
}
