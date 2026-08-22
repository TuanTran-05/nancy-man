import type {
  AssignmentAssessmentInput,
  QuestionMedia,
} from '../../../../shared/assignmentAssessment';

interface StudentAssessmentPreviewProps {
  assessment: AssignmentAssessmentInput;
}

function MediaPreview({ media }: { media: QuestionMedia }) {
  if (media.type === 'audio') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-500">{media.title || 'Audio'}</p>
        <audio controls src={media.url} className="w-full" />
      </div>
    );
  }
  if (media.type === 'video') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-500">{media.title || 'Video'}</p>
        <video controls src={media.url} className="max-h-72 w-full rounded-lg bg-black" />
      </div>
    );
  }
  if (media.type === 'image') {
    return (
      <figure className="space-y-1">
        <img
          src={media.url}
          alt={media.altText || media.title || 'Question media'}
          className="max-h-72 rounded-lg border border-slate-200 object-contain"
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
      className="text-sm font-semibold text-blue-600 underline"
    >
      {media.title || 'Open document'}
    </a>
  );
}

export function StudentAssessmentPreview({ assessment }: StudentAssessmentPreviewProps) {
  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-4">
      {assessment.sections.map((section) => (
        <section key={section.id} className="space-y-4">
          <div>
            <h3 className="text-lg font-black text-slate-950">{section.title}</h3>
            {section.instructions && (
              <p className="mt-1 text-sm text-slate-500">{section.instructions}</p>
            )}
          </div>
          {section.questions.map((question, index) => (
            <article key={question.id} className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-slate-500">Question {index + 1}</p>
                {question.required && (
                  <span className="inline-flex w-max rounded-full bg-red-50 px-2 py-1 text-xs font-black text-red-700">
                    Required
                  </span>
                )}
              </div>
              <p className="text-base font-semibold text-slate-900">{question.prompt}</p>
              {question.media.length > 0 && (
                <div className="space-y-3">
                  {question.media.map((media) => (
                    <MediaPreview key={media.id} media={media} />
                  ))}
                </div>
              )}
              {question.responseMode === 'multiple_choice' ? (
                <div className="space-y-2">
                  {(question.options || []).map((option) => (
                    <label
                      key={option.key}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <input type="radio" name={question.id} />
                      <span className="font-bold text-slate-500">{option.key}</span>
                      <span>{option.text}</span>
                      {question.optionMedia?.[option.key]?.map((media) =>
                        media.type === 'image' ? (
                          <img
                            key={media.id}
                            src={media.url}
                            alt={media.altText || media.title || `${option.key} option image`}
                            className="ml-auto max-h-16 rounded-lg border border-slate-200 object-contain"
                          />
                        ) : null
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  readOnly
                  aria-label={`Preview answer for ${question.prompt}`}
                  placeholder="Student short answer"
                  className="min-h-24 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                />
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
