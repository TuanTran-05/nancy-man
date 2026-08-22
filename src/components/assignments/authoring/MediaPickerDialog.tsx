import { useState } from 'react';
import { Link, Upload, X } from 'lucide-react';
import type { AssessmentMediaBankItem } from '../../../../shared/assignmentAuthoring';
import type { QuestionMedia, QuestionMediaType } from '../../../../shared/assignmentAssessment';
import { uploadAssignmentMedia } from '../../../lib/api/uploadAssignmentMedia';
import { MediaBankPanel } from './MediaBankPanel';

interface MediaPickerDialogProps {
  open: boolean;
  classId: string;
  mediaKind?: 'image' | 'audio' | 'video';
  onClose: () => void;
  onInsert: (item: AssessmentMediaBankItem) => void;
}

const fileAcceptByType: Record<'image' | 'audio' | 'video', string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

function createLocalMediaBankItem(
  media: Pick<
    AssessmentMediaBankItem,
    | 'type'
    | 'source'
    | 'url'
    | 'storagePath'
    | 'title'
    | 'altText'
    | 'transcript'
    | 'thumbnailUrl'
    | 'durationSeconds'
  >
): AssessmentMediaBankItem {
  const now = new Date().toISOString();
  return {
    id: `local-media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ownerUid: 'local',
    visibility: 'private',
    type: media.type,
    source: media.source,
    url: media.url,
    ...(media.storagePath ? { storagePath: media.storagePath } : {}),
    ...(media.title ? { title: media.title } : {}),
    ...(media.altText ? { altText: media.altText } : {}),
    ...(media.transcript ? { transcript: media.transcript } : {}),
    ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
    ...(media.durationSeconds !== undefined ? { durationSeconds: media.durationSeconds } : {}),
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createUploadedMediaBankItem(media: QuestionMedia): AssessmentMediaBankItem {
  return createLocalMediaBankItem({
    type: media.type,
    source: media.source,
    url: media.url,
    storagePath: media.storagePath,
    title: media.title,
    altText: media.altText,
    transcript: media.transcript,
    thumbnailUrl: media.thumbnailUrl,
    durationSeconds: media.durationSeconds,
  });
}

export function MediaPickerDialog({
  open,
  classId,
  mediaKind,
  onClose,
  onInsert,
}: MediaPickerDialogProps) {
  const resolvedMediaType = mediaKind || 'image';
  const [sourceMode, setSourceMode] = useState<'url' | 'upload'>('url');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const clearFields = () => {
    setTitle('');
    setUrl('');
    setAltText('');
    setTranscript('');
    setFile(null);
    setError('');
  };

  const addUrlMedia = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('https://')) {
      setError('Media URL must start with https://');
      return;
    }
    onInsert(
      createLocalMediaBankItem({
        type: resolvedMediaType,
        source: 'external_url',
        url: trimmedUrl,
        title: title.trim() || undefined,
        altText: altText.trim() || undefined,
        transcript: transcript.trim() || undefined,
      })
    );
    clearFields();
  };

  const uploadMedia = async () => {
    if (!file) {
      setError('Choose a media file first.');
      return;
    }
    if (!classId) {
      setError('Choose a class before uploading media.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadAssignmentMedia({
        classId,
        mediaType: resolvedMediaType as QuestionMediaType,
        file,
        title: title.trim() || undefined,
        altText: altText.trim() || undefined,
        transcript: transcript.trim() || undefined,
      });
      onInsert(createUploadedMediaBankItem(uploaded));
      clearFields();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload media.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 dark:bg-slate-950/70">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Media picker"
        className="mx-auto max-h-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 dark:text-slate-100 dark:shadow-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">{mediaKind ? `Add ${mediaKind}` : 'Add media'}</h2>
          <button
            type="button"
            aria-label="Close media picker"
            onClick={() => {
              clearFields();
              onClose();
            }}
            className="rounded-xl border border-slate-200 p-2 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => {
              setSourceMode('url');
              setError('');
            }}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${
              sourceMode === 'url'
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-indigo-200 dark:shadow-none'
                : 'text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700/80'
            }`}
          >
            <Link className="h-4 w-4" aria-hidden="true" />
            Paste link
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceMode('upload');
              setError('');
            }}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${
              sourceMode === 'upload'
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-indigo-200 dark:shadow-none'
                : 'text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700/80'
            }`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload file
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <label className="block text-xs font-black uppercase text-slate-500 dark:text-slate-400">
            Media title
            <input
              aria-label="Media title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`${resolvedMediaType} title`}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
            />
          </label>

          {sourceMode === 'url' ? (
            <label className="block text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Media URL
              <input
                aria-label="Media URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://..."
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
              />
            </label>
          ) : (
            <label className="block text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Media file
              <input
                aria-label="Media file"
                type="file"
                accept={fileAcceptByType[resolvedMediaType]}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="mt-1.5 w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-indigo-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:file:bg-indigo-500/15 dark:file:text-indigo-200"
              />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Alt text
              <input
                aria-label="Alt text"
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
                disabled={resolvedMediaType !== 'image'}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
              />
            </label>
            <label className="block text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Transcript
              <input
                aria-label="Transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                disabled={resolvedMediaType === 'image'}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
              />
            </label>
          </div>

          {error && <p className="text-sm font-bold text-red-600">{error}</p>}

          <button
            type="button"
            onClick={sourceMode === 'url' ? addUrlMedia : () => void uploadMedia()}
            disabled={uploading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sourceMode === 'url' ? (
              <>
                <Link className="h-4 w-4" aria-hidden="true" />
                Add link
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? 'Uploading...' : 'Upload media'}
              </>
            )}
          </button>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs font-black uppercase text-slate-400 dark:text-slate-500">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          Or insert from media bank
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>

        <MediaBankPanel onInsert={onInsert} />
      </section>
    </div>
  );
}
