// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAssignmentMedia } from '../../../lib/api/uploadAssignmentMedia';
import { searchMediaBank } from '../../../lib/api/assignmentAuthoringApi';
import { MediaPickerDialog } from './MediaPickerDialog';

vi.mock('../../../lib/api/uploadAssignmentMedia', () => ({
  uploadAssignmentMedia: vi.fn(),
}));

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  searchMediaBank: vi.fn(),
}));

describe('MediaPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchMediaBank).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('inserts pasted HTTPS media links', () => {
    const onInsert = vi.fn();
    render(
      <MediaPickerDialog
        open
        classId="class-1"
        mediaKind="image"
        onClose={vi.fn()}
        onInsert={onInsert}
      />
    );

    fireEvent.change(screen.getByLabelText('Media title'), {
      target: { value: 'Prompt image' },
    });
    fireEvent.change(screen.getByLabelText('Media URL'), {
      target: { value: 'https://cdn.example.com/prompt.png' },
    });
    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'Students looking at a poster' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));

    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'image',
        source: 'external_url',
        url: 'https://cdn.example.com/prompt.png',
        title: 'Prompt image',
        altText: 'Students looking at a poster',
      })
    );
  });

  it('uploads local files and inserts returned media', async () => {
    const onInsert = vi.fn();
    vi.mocked(uploadAssignmentMedia).mockResolvedValue({
      id: 'uploaded-audio',
      type: 'audio',
      source: 'upload',
      url: 'https://cdn.example.com/listening.mp3',
      storagePath: 'assignment_media/class-1/listening.mp3',
      title: 'Listening audio',
    });

    render(
      <MediaPickerDialog
        open
        classId="class-1"
        mediaKind="audio"
        onClose={vi.fn()}
        onInsert={onInsert}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
    fireEvent.change(screen.getByLabelText('Media title'), {
      target: { value: 'Listening audio' },
    });
    fireEvent.change(screen.getByLabelText('Transcript'), {
      target: { value: 'Audio transcript' },
    });
    fireEvent.change(screen.getByLabelText('Media file'), {
      target: { files: [new File(['audio'], 'listening.mp3', { type: 'audio/mpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload media' }));

    await waitFor(() => {
      expect(uploadAssignmentMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class-1',
          mediaType: 'audio',
          file: expect.any(File),
          title: 'Listening audio',
          transcript: 'Audio transcript',
        })
      );
    });
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audio',
        source: 'upload',
        url: 'https://cdn.example.com/listening.mp3',
        storagePath: 'assignment_media/class-1/listening.mp3',
        title: 'Listening audio',
      })
    );
  });

  it('explains that upload needs a selected class', async () => {
    render(
      <MediaPickerDialog open classId="" mediaKind="video" onClose={vi.fn()} onInsert={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
    fireEvent.change(screen.getByLabelText('Media file'), {
      target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload media' }));

    expect(await screen.findByText('Choose a class before uploading media.')).toBeInTheDocument();
    expect(uploadAssignmentMedia).not.toHaveBeenCalled();
  });
});
