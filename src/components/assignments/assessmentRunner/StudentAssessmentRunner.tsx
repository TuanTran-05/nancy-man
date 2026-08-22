import { useState } from 'react';
import { Check, FileText } from 'lucide-react';
import type {
  AssessmentAnswer,
  AssessmentQuestion,
  AssignmentAssessment,
  QuestionMedia,
} from '../../../../shared/assignmentAssessment';
import { uploadAssignmentAnswerMedia } from '../../../lib/api/uploadAssignmentAnswerMedia';
import { getAssessmentQuestionList } from '../../../../shared/assignmentAssessment';
import { cn } from '../../../lib/core/utils';
import { useLanguage } from '../../../lib/i18n/useLanguage';
import {
  getAnswerForQuestion,
  getRunnerProgress,
  upsertAssessmentAnswer,
} from './assessmentRunnerState';

interface StudentAssessmentRunnerProps {
  assignmentId: string;
  classId: string;
  assessment: AssignmentAssessment;
  answers: AssessmentAnswer[];
  onAnswersChange: (answers: AssessmentAnswer[]) => void;
}

interface MediaLabels {
  audio: string;
  video: string;
  questionMedia: string;
  openDocument: string;
}

function MediaView({ media, labels }: { media: QuestionMedia; labels: MediaLabels }) {
  if (media.type === 'audio') {
    return (
      <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
        <p className="text-xs font-black uppercase text-blue-700">{media.title || labels.audio}</p>
        <audio controls src={media.url} className="w-full" />
      </div>
    );
  }

  if (media.type === 'video') {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-black uppercase text-slate-600">{media.title || labels.video}</p>
        <video controls src={media.url} className="max-h-80 w-full rounded-lg bg-black" />
      </div>
    );
  }

  if (media.type === 'image') {
    return (
      <figure className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <img
          src={media.url}
          alt={media.altText || media.title || labels.questionMedia}
          className="max-h-80 w-full rounded-lg object-contain"
        />
        {media.title && (
          <figcaption className="text-xs font-bold text-slate-500">{media.title}</figcaption>
        )}
      </figure>
    );
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50"
    >
      <FileText className="h-4 w-4" />
      {media.title || labels.openDocument}
    </a>
  );
}

function MultipleChoiceQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: AssessmentQuestion;
  answer: AssessmentAnswer | null;
  onAnswer: (answer: AssessmentAnswer) => void;
}) {
  return (
    <div className="grid gap-3">
      {(question.options || []).map((option) => {
        const selected =
          answer?.responseMode === 'multiple_choice' && answer.selectedOption === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() =>
              onAnswer({
                questionId: question.id,
                responseMode: 'multiple_choice',
                selectedOption: option.key,
              })
            }
            className={cn(
              'flex min-h-14 items-center gap-4 rounded-xl border px-4 text-left transition',
              selected
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-black',
                selected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
              )}
            >
              {option.key}
            </span>
            <span className="min-w-0 flex-1 text-base font-medium">{option.text}</span>
            {selected && <Check className="h-5 w-5 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

function ShortAnswerQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: AssessmentQuestion;
  answer: AssessmentAnswer | null;
  onAnswer: (answer: AssessmentAnswer) => void;
}) {
  return (
    <textarea
      aria-label={`Answer for ${question.prompt}`}
      value={answer?.responseMode === 'short_answer' ? answer.textAnswer || '' : ''}
      onChange={(event) =>
        onAnswer({
          questionId: question.id,
          responseMode: 'short_answer',
          textAnswer: event.target.value,
        })
      }
      rows={4}
      className="min-h-28 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
    />
  );
}

function SpeakingRecordingQuestion({
  assignmentId,
  question,
  answer,
  onAnswer,
}: {
  assignmentId: string;
  question: AssessmentQuestion;
  answer: AssessmentAnswer | null;
  onAnswer: (answer: AssessmentAnswer) => void;
}) {
  const { t } = useLanguage();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError('');
    try {
      const recording = await uploadAssignmentAnswerMedia({
        assignmentId,
        questionId: question.id,
        mediaType: 'audio',
        file,
      });
      onAnswer({ questionId: question.id, responseMode: 'speaking_recording', recording });
    } catch {
      setError(t.submissionModal.recordingUploadError);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="block text-sm font-bold text-slate-700">
        {t.submissionModal.uploadSpeakingRecording}
        <input
          aria-label={t.submissionModal.uploadSpeakingRecording}
          type="file"
          accept="audio/webm,audio/mpeg,audio/mp4,audio/wav"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
          className="mt-2 block w-full text-sm"
        />
      </label>
      {isUploading && (
        <p className="text-sm font-semibold text-blue-700">
          {t.submissionModal.uploadingRecording}
        </p>
      )}
      {answer?.responseMode === 'speaking_recording' && answer.recording && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-emerald-700">
            {t.submissionModal.recordingUploaded}
          </p>
          <audio controls src={answer.recording.url} className="w-full" />
        </div>
      )}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    </div>
  );
}

function LongAnswerQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: AssessmentQuestion;
  answer: AssessmentAnswer | null;
  onAnswer: (answer: AssessmentAnswer) => void;
}) {
  const { t } = useLanguage();
  return (
    <textarea
      aria-label={`Answer for ${question.prompt}`}
      placeholder={t.submissionModal.writeLongAnswer}
      value={answer?.responseMode === 'long_answer' ? answer.textAnswer || '' : ''}
      onChange={(event) =>
        onAnswer({
          questionId: question.id,
          responseMode: 'long_answer',
          textAnswer: event.target.value,
        })
      }
      rows={8}
      className="min-h-48 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
    />
  );
}

function FileUploadQuestion({
  assignmentId,
  question,
  answer,
  onAnswer,
}: {
  assignmentId: string;
  question: AssessmentQuestion;
  answer: AssessmentAnswer | null;
  onAnswer: (answer: AssessmentAnswer) => void;
}) {
  const { t } = useLanguage();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError('');
    try {
      const uploadedFile = await uploadAssignmentAnswerMedia({
        assignmentId,
        questionId: question.id,
        mediaType: 'document',
        file,
      });
      onAnswer({ questionId: question.id, responseMode: 'file_upload', uploadedFile });
    } catch {
      setError(t.submissionModal.fileUploadError);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="block text-sm font-bold text-slate-700">
        {t.submissionModal.uploadFile}
        <input
          aria-label={t.submissionModal.uploadFile}
          type="file"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
          className="mt-2 block w-full text-sm"
        />
      </label>
      {isUploading && (
        <p className="text-sm font-semibold text-blue-700">{t.submissionModal.uploadingFile}</p>
      )}
      {answer?.responseMode === 'file_upload' && answer.uploadedFile && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-emerald-700">{t.submissionModal.fileUploaded}</p>
          <a
            href={answer.uploadedFile.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50"
          >
            <FileText className="h-4 w-4" />
            {answer.uploadedFile.title || t.submissionModal.openDocument}
          </a>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    </div>
  );
}

export function StudentAssessmentRunner({
  assignmentId,
  classId,
  assessment,
  answers,
  onAnswersChange,
}: StudentAssessmentRunnerProps) {
  const { t } = useLanguage();
  const progress = getRunnerProgress(assessment, answers);
  const questions = getAssessmentQuestionList(assessment);
  const mediaLabels = {
    audio: t.submissionModal.audio,
    video: t.submissionModal.video,
    questionMedia: t.submissionModal.questionMedia,
    openDocument: t.submissionModal.openDocument,
  };

  const emitAnswer = (answer: AssessmentAnswer) => {
    onAnswersChange(upsertAssessmentAnswer(answers, answer));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        {assessment.sections.map((section) => (
          <section key={section.id} className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
              <h3 className="text-xl font-black text-blue-800">{section.title}</h3>
              {section.instructions && (
                <p className="mt-2 text-sm font-semibold text-blue-700">{section.instructions}</p>
              )}
            </div>

            {section.questions.map((question, index) => {
              const answer = getAnswerForQuestion(answers, question.id);
              return (
                <article
                  key={question.id}
                  className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-black leading-7 text-slate-950">
                        {question.prompt}
                      </p>
                      {question.points !== undefined && (
                        <p className="mt-1 text-xs font-bold uppercase text-slate-400">
                          {t.submissionModal.points.replace('{count}', String(question.points))}
                        </p>
                      )}
                    </div>
                  </div>

                  {question.media.length > 0 && (
                    <div className="space-y-3">
                      {question.media.map((media) => (
                        <MediaView key={media.id} media={media} labels={mediaLabels} />
                      ))}
                    </div>
                  )}

                  {question.responseMode === 'multiple_choice' ? (
                    <MultipleChoiceQuestion
                      question={question}
                      answer={answer}
                      onAnswer={emitAnswer}
                    />
                  ) : question.responseMode === 'speaking_recording' ? (
                    <SpeakingRecordingQuestion
                      assignmentId={assignmentId}
                      question={question}
                      answer={answer}
                      onAnswer={emitAnswer}
                    />
                  ) : question.responseMode === 'long_answer' ? (
                    <LongAnswerQuestion question={question} answer={answer} onAnswer={emitAnswer} />
                  ) : question.responseMode === 'file_upload' ? (
                    <FileUploadQuestion
                      assignmentId={assignmentId}
                      question={question}
                      answer={answer}
                      onAnswer={emitAnswer}
                    />
                  ) : (
                    <ShortAnswerQuestion
                      question={question}
                      answer={answer}
                      onAnswer={emitAnswer}
                    />
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-black uppercase text-blue-700">
            {t.submissionModal.assessmentProgress}
          </h3>
          <p className="mt-4 text-3xl font-black text-slate-950">
            {progress.answered}/{progress.total}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-600"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {questions.map((question, index) => {
            const answered = Boolean(getAnswerForQuestion(answers, question.id));
            return (
              <span
                key={question.id}
                className={cn(
                  'flex h-10 items-center justify-center rounded-lg border text-sm font-black',
                  answered
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-blue-300 text-blue-600'
                )}
              >
                {index + 1}
              </span>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
