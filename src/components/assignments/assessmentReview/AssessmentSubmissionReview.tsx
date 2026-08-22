import type {
  AssessmentAnswer,
  AssessmentScore,
  AssignmentAssessment,
  PrivateAssessmentQuestionKey,
} from '../../../../shared/assignmentAssessment';
import { getAssessmentQuestionList } from '../../../../shared/assignmentAssessment';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import { AssessmentMediaView } from './AssessmentMediaView';
import type { AssessmentGradingDraft } from './assessmentReviewState';
import { updateAssessmentQuestionDraft } from './assessmentReviewState';

interface AssessmentSubmissionReviewProps {
  assessment: AssignmentAssessment;
  answers: AssessmentAnswer[];
  score?: AssessmentScore | null;
  keyMap?: Record<string, PrivateAssessmentQuestionKey>;
  canGrade: boolean;
  showCorrectAnswers: boolean;
  gradingDraft?: AssessmentGradingDraft;
  onDraftChange?: (draft: AssessmentGradingDraft) => void;
  submissionStatus?: 'submitted' | 'graded';
}

export function AssessmentSubmissionReview({
  assessment,
  answers,
  score,
  keyMap = {},
  canGrade,
  showCorrectAnswers,
  gradingDraft,
  onDraftChange,
  submissionStatus,
}: AssessmentSubmissionReviewProps) {
  const { t } = useLanguage();
  const T = t.assessmentReview;
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const scoreByQuestion = new Map(
    (score?.questionScores || []).map((item) => [item.questionId, item])
  );
  const mediaLabels = {
    audio: T.audio,
    video: T.video,
    questionMedia: T.questionMedia,
    openDocument: T.openDocument,
  };

  return (
    <div className="space-y-5">
      {assessment.sections.map((section) => (
        <section key={section.id} className="space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-lg font-black text-blue-800">{section.title}</h3>
            {section.instructions && (
              <p className="mt-1 text-sm font-semibold text-blue-700">{section.instructions}</p>
            )}
          </div>

          {section.questions.map((question, index) => {
            const answer = answerByQuestion.get(question.id);
            const questionScore = scoreByQuestion.get(question.id);
            const key = keyMap[question.id];
            const draft = gradingDraft?.[question.id];

            return (
              <article
                key={question.id}
                className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase text-slate-400">#{index + 1}</p>
                    <p className="mt-1 text-base font-black leading-7 text-slate-950">
                      {question.prompt}
                    </p>
                  </div>
                  {questionScore && (
                    <div className="flex items-center gap-2">
                      {questionScore.gradingMode === 'manual' &&
                        submissionStatus === 'submitted' && (
                          <span className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-black text-amber-700">
                            {T.pendingGrading}
                          </span>
                        )}
                      <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                        {T.points
                          .replace('{points}', String(questionScore.pointsAwarded))
                          .replace('{max}', String(questionScore.maxPoints))}
                      </span>
                    </div>
                  )}
                </div>

                {question.media.length > 0 && (
                  <div className="space-y-3">
                    {question.media.map((media) => (
                      <AssessmentMediaView key={media.id} media={media} labels={mediaLabels} />
                    ))}
                  </div>
                )}

                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <p className="text-xs font-black uppercase text-slate-400">
                    {question.responseMode === 'multiple_choice' ? T.selectedAnswer : T.textAnswer}
                  </p>
                  {answer?.responseMode === 'multiple_choice' && (
                    <p className="mt-2 font-bold text-slate-800">{answer.selectedOption}</p>
                  )}
                  {(answer?.responseMode === 'short_answer' ||
                    answer?.responseMode === 'long_answer') && (
                    <p className="mt-2 whitespace-pre-wrap font-medium text-slate-800">
                      {answer.textAnswer}
                    </p>
                  )}
                  {answer?.responseMode === 'speaking_recording' && answer.recording && (
                    <div className="mt-2 space-y-2">
                      <p className="font-bold text-slate-800">{T.recording}</p>
                      <audio controls src={answer.recording.url} className="w-full" />
                    </div>
                  )}
                  {answer?.responseMode === 'file_upload' && answer.uploadedFile && (
                    <div className="mt-2 space-y-2">
                      <p className="font-bold text-slate-800">{T.uploadedFile}</p>
                      <a
                        href={answer.uploadedFile.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50"
                      >
                        {answer.uploadedFile.title || T.openFile}
                      </a>
                    </div>
                  )}
                  {!answer && <p className="mt-2 italic text-slate-500">{T.noAnswer}</p>}
                </div>

                {showCorrectAnswers && key && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                    {key.correctAnswer !== undefined && (
                      <p>
                        <span className="font-black">{T.correctAnswer}: </span>
                        {Array.isArray(key.correctAnswer)
                          ? key.correctAnswer.join(', ')
                          : key.correctAnswer}
                      </p>
                    )}
                    {key.acceptedAnswers !== undefined && (
                      <p>
                        <span className="font-black">{T.acceptedAnswers}: </span>
                        {key.acceptedAnswers.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {!canGrade && questionScore?.feedback && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="text-xs font-black uppercase text-amber-700">
                      {T.questionFeedback}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap font-semibold">
                      {questionScore.feedback}
                    </p>
                  </div>
                )}

                {canGrade && draft && gradingDraft && onDraftChange && (
                  <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <label className="text-xs font-black uppercase text-slate-500">
                      {T.scoreInput}
                      <input
                        aria-label={`Score for ${question.prompt}`}
                        type="number"
                        min="0"
                        max={question.points ?? 1}
                        step="0.1"
                        value={draft.pointsAwarded}
                        onChange={(event) =>
                          onDraftChange(
                            updateAssessmentQuestionDraft(gradingDraft, question.id, {
                              pointsAwarded: event.target.value,
                            })
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <label className="text-xs font-black uppercase text-slate-500">
                      {T.teacherFeedback}
                      <input
                        value={draft.feedback}
                        onChange={(event) =>
                          onDraftChange(
                            updateAssessmentQuestionDraft(gradingDraft, question.id, {
                              feedback: event.target.value,
                            })
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
