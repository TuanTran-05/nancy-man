import { FileText, FolderPlus, Image, LibraryBig, Music, Plus, Video } from 'lucide-react';
import type { AuthoringToolbarMode } from './authoringUiState';

interface FloatingInsertToolbarProps {
  mode: AuthoringToolbarMode;
  onAddQuestion: () => void;
  onAddSection: () => void;
  onOpenQuestionBank: () => void;
  onOpenMediaPicker: (type: 'image' | 'audio' | 'video') => void;
}

export function FloatingInsertToolbar({
  mode,
  onAddQuestion,
  onAddSection,
  onOpenQuestionBank,
  onOpenMediaPicker,
}: FloatingInsertToolbarProps) {
  const className =
    mode === 'bottom'
      ? 'fixed inset-x-3 bottom-3 z-30 flex justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl'
      : 'sticky top-32 z-20 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl';

  return (
    <aside aria-label="Insert tools" className={className}>
      <button
        type="button"
        onClick={onAddQuestion}
        aria-label="Add question"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-indigo-700 hover:bg-indigo-50"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Add title or description"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <FileText className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onOpenMediaPicker('image')}
        aria-label="Add image"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <Image className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onOpenMediaPicker('audio')}
        aria-label="Add audio"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <Music className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onOpenMediaPicker('video')}
        aria-label="Add video"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <Video className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onAddSection}
        aria-label="Add section"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <FolderPlus className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onOpenQuestionBank}
        aria-label="Insert from question bank"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50"
      >
        <LibraryBig className="h-5 w-5" aria-hidden="true" />
      </button>
    </aside>
  );
}
