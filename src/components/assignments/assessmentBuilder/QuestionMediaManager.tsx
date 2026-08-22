import { useState } from 'react';
import { Image, Link, Upload, X } from 'lucide-react';
import type { QuestionMedia, QuestionMediaType } from '../../../../shared/assignmentAssessment';
import { uploadAssignmentMedia } from '../../../lib/api/uploadAssignmentMedia';

interface QuestionMediaManagerProps {
  classId: string;
  media: QuestionMedia[];
  labels?: {
    title: string;
    addMedia: string;
    hideMedia: string;
  };
  onChange: (media: QuestionMedia[]) => void;
}

const mediaTypes: QuestionMediaType[] = ['audio', 'video', 'image', 'document'];

function mediaId() {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuestionMediaManager({
  classId,
  media,
  labels,
  onChange,
}: QuestionMediaManagerProps) {
  const [mediaType, setMediaType] = useState<QuestionMediaType>('audio');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const [isExpanded, setIsExpanded] = useState(media.length > 0);
  const titleLabel = labels?.title || 'Question media';
  const addMediaLabel = labels?.addMedia || 'Add media';
  const hideMediaLabel = labels?.hideMedia || 'Hide media';

  const addUrlMedia = () => {
    if (!url.trim().startsWith('https://')) {
      setError('Media URL must start with https://');
      return;
    }
    onChange([
      ...media,
      {
        id: mediaId(),
        type: mediaType,
        source: 'external_url',
        url: url.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(altText.trim() ? { altText: altText.trim() } : {}),
        ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
        displayMode: 'inline',
      },
    ]);
    setUrl('');
    setTitle('');
    setAltText('');
    setTranscript('');
    setError('');
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
        mediaType,
        file,
        title: title.trim() || undefined,
        altText: altText.trim() || undefined,
        transcript: transcript.trim() || undefined,
      });
      onChange([...media, uploaded]);
      setFile(null);
      setTitle('');
      setAltText('');
      setTranscript('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload media.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Image className="h-4 w-4 text-violet-600" />
          {titleLabel}
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {isExpanded ? hideMediaLabel : addMediaLabel}
        </button>
      </div>

      {media.length > 0 && (
        <div className="space-y-2">
          {media.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm"
            >
              <span className="truncate">
                {item.type}: {item.title || item.url}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.title || item.type}`}
                onClick={() => onChange(media.filter((existing) => existing.id !== item.id))}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {isExpanded && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Media type
              <select
                aria-label="Media type"
                value={mediaType}
                onChange={(event) => setMediaType(event.target.value as QuestionMediaType)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                {mediaTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Media title
              <input
                aria-label="Media title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-600">
            Media URL
            <input
              aria-label="Media URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Alt text
              <input
                aria-label="Alt text"
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Transcript
              <input
                aria-label="Transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-600">
            Media file
            <input
              aria-label="Media file"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
            />
          </label>

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addUrlMedia}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
            >
              <Link className="h-4 w-4" />
              Add URL media
            </button>
            <button
              type="button"
              onClick={() => void uploadMedia()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload media'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
