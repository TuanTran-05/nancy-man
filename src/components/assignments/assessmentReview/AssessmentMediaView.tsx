import { FileText } from 'lucide-react';
import type { QuestionMedia } from '../../../../shared/assignmentAssessment';

interface AssessmentMediaViewProps {
  media: QuestionMedia;
  labels: {
    audio: string;
    video: string;
    questionMedia: string;
    openDocument: string;
  };
}

export function AssessmentMediaView({ media, labels }: AssessmentMediaViewProps) {
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
