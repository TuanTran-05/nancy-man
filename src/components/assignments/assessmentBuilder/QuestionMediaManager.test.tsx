// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionMediaManager } from './QuestionMediaManager';
import { uploadAssignmentMedia } from '../../../lib/api/uploadAssignmentMedia';

vi.mock('../../../lib/api/uploadAssignmentMedia', () => ({
  uploadAssignmentMedia: vi.fn(),
}));

describe('QuestionMediaManager', () => {
  it('adds external URL media', () => {
    const onChange = vi.fn();
    render(<QuestionMediaManager classId="class-1" media={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add media' }));

    fireEvent.change(screen.getByLabelText('Media title'), { target: { value: 'Audio prompt' } });
    fireEvent.change(screen.getByLabelText('Media URL'), {
      target: { value: 'https://cdn.example.com/audio.mp3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add URL media' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'audio',
        source: 'external_url',
        title: 'Audio prompt',
        url: 'https://cdn.example.com/audio.mp3',
        displayMode: 'inline',
      }),
    ]);
  });

  it('uploads a file and appends returned media', async () => {
    const onChange = vi.fn();
    vi.mocked(uploadAssignmentMedia).mockResolvedValue({
      id: 'media-uploaded',
      type: 'image',
      source: 'upload',
      url: 'https://cdn.example.com/image.png',
      storagePath: 'assignment_media/class-1/image.png',
    });

    render(<QuestionMediaManager classId="class-1" media={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add media' }));

    fireEvent.change(screen.getByLabelText('Media type'), { target: { value: 'image' } });
    fireEvent.change(screen.getByLabelText('Media file'), {
      target: { files: [new File(['image'], 'image.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload media' }));

    await waitFor(() => {
      expect(uploadAssignmentMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class-1',
          mediaType: 'image',
          file: expect.any(File),
        })
      );
    });
    expect(onChange).toHaveBeenCalledWith([
      {
        id: 'media-uploaded',
        type: 'image',
        source: 'upload',
        url: 'https://cdn.example.com/image.png',
        storagePath: 'assignment_media/class-1/image.png',
      },
    ]);
  });

  it('keeps media controls collapsed until the teacher asks for them', () => {
    render(<QuestionMediaManager classId="class-1" media={[]} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Add media' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Media URL')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add media' }));

    expect(screen.getByLabelText('Media URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide media' })).toBeInTheDocument();
  });
});
