import { Image, Music, Video, X } from 'lucide-react';
import type { QuestionMedia } from '../../../../shared/assignmentAssessment';

interface QuestionMediaStripProps {
  media: QuestionMedia[];
  onRemove: (mediaId: string) => void;
}

function iconForMedia(type: QuestionMedia['type']) {
  if (type === 'audio') return Music;
  if (type === 'video') return Video;
  return Image;
}

export function QuestionMediaStrip({ media, onRemove }: QuestionMediaStripProps) {
  if (media.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {media.map((item) => {
        const Icon = iconForMedia(item.type);
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-800">{item.title || item.url}</p>
              <p className="text-xs text-slate-500">{item.type}</p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.title || item.type}`}
              className="rounded-lg p-1 text-slate-500 hover:bg-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
