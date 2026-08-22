// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssignmentAssessment } from '../../../../shared/assignmentAssessment';
import { StudentAssessmentRunner } from './StudentAssessmentRunner';
import { uploadAssignmentAnswerMedia } from '../../../lib/api/uploadAssignmentAnswerMedia';

vi.mock('../../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      submissionModal: {
        assessmentProgress: 'Localized progress',
        points: '{count} localized point(s)',
        audio: 'Localized audio',
        video: 'Localized video',
        questionMedia: 'Localized question media',
        openDocument: 'Localized document',
        uploadSpeakingRecording: 'Upload speaking recording',
        uploadingRecording: 'Uploading recording...',
        recordingUploaded: 'Recording uploaded',
        recordingUploadError: 'Could not upload the recording. Please try again.',
        uploadFile: 'Upload file',
        uploadingFile: 'Uploading file...',
        fileUploaded: 'File uploaded',
        fileUploadError: 'Could not upload the file. Please try again.',
      },
    },
  }),
}));

vi.mock('../../../lib/api/uploadAssignmentAnswerMedia', () => ({
  uploadAssignmentAnswerMedia: vi.fn().mockResolvedValue({
    id: 'recording-1',
    type: 'audio',
    source: 'upload',
    url: 'https://cdn.example.com/recording.webm',
    storagePath: 'assignment_answers/assignment-1/student-1/q-speaking/recording.webm',
  }),
}));

const assessment: AssignmentAssessment = {
  version: 2,
  mode: 'practice',
  settings: {
    allowFreeMediaPlayback: true,
    showCorrectAnswersAfterSubmit: false,
    showTranscriptDuringAttempt: false,
  },
  sections: [
    {
      id: 'listening',
      title: 'Listening',
      skill: 'listening',
      instructions: 'Listen carefully.',
      questions: [
        {
          id: 'q1',
          skill: 'listening',
          prompt: 'What does the speaker want?',
          responseMode: 'multiple_choice',
          media: [
            {
              id: 'm1',
              type: 'audio',
              source: 'external_url',
              url: 'https://cdn.example.com/dialogue.mp3',
              title: 'Dialogue',
              displayMode: 'inline',
            },
          ],
          options: [
            { key: 'A', text: 'A ticket' },
            { key: 'B', text: 'A book' },
          ],
        },
        {
          id: 'q2',
          skill: 'reading',
          prompt: 'Write the missing word.',
          responseMode: 'short_answer',
          media: [],
        },
      ],
    },
  ],
};

describe('StudentAssessmentRunner', () => {
  it('renders media, multiple-choice, and short-answer controls', () => {
    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={assessment}
        answers={[]}
        onAnswersChange={vi.fn()}
      />
    );

    expect(screen.getByText('Listening')).toBeInTheDocument();
    expect(screen.getByText('Listen carefully.')).toBeInTheDocument();
    expect(screen.getByText('Dialogue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A ticket/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Answer for Write the missing word.')).toBeInTheDocument();
  });

  it('emits normalized answer changes', () => {
    const onAnswersChange = vi.fn();
    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={assessment}
        answers={[]}
        onAnswersChange={onAnswersChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /A ticket/i }));
    expect(onAnswersChange).toHaveBeenCalledWith([
      { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'A' },
    ]);

    fireEvent.change(screen.getByLabelText('Answer for Write the missing word.'), {
      target: { value: 'station' },
    });
    expect(onAnswersChange).toHaveBeenLastCalledWith([
      { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
    ]);
  });

  it('uses localized fallback labels for untitled media', () => {
    const localizedAssessment: AssignmentAssessment = {
      ...assessment,
      sections: [
        {
          ...assessment.sections[0],
          questions: [
            {
              ...assessment.sections[0].questions[0],
              media: [
                {
                  id: 'audio-untitled',
                  type: 'audio',
                  source: 'external_url',
                  url: 'https://cdn.example.com/audio.mp3',
                },
                {
                  id: 'video-untitled',
                  type: 'video',
                  source: 'external_url',
                  url: 'https://cdn.example.com/video.mp4',
                },
                {
                  id: 'image-untitled',
                  type: 'image',
                  source: 'external_url',
                  url: 'https://cdn.example.com/image.png',
                },
                {
                  id: 'doc-untitled',
                  type: 'document',
                  source: 'external_url',
                  url: 'https://cdn.example.com/file.pdf',
                },
              ],
            },
          ],
        },
      ],
    };

    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={localizedAssessment}
        answers={[]}
        onAnswersChange={vi.fn()}
      />
    );

    expect(screen.getByText('Localized audio')).toBeInTheDocument();
    expect(screen.getByText('Localized video')).toBeInTheDocument();
    expect(screen.getByAltText('Localized question media')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Localized document/i })).toBeInTheDocument();
  });

  it('uploads a speaking recording and emits a speaking answer', async () => {
    const onAnswersChange = vi.fn();
    const speakingAssessment = {
      ...assessment,
      sections: [
        {
          ...assessment.sections[0],
          questions: [
            {
              id: 'q-speaking',
              skill: 'speaking',
              prompt: 'Say your answer.',
              responseMode: 'speaking_recording',
              media: [],
              points: 3,
            },
          ],
        },
      ],
    } as AssignmentAssessment;

    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={speakingAssessment}
        answers={[]}
        onAnswersChange={onAnswersChange}
      />
    );

    const file = new File([new Blob(['voice'], { type: 'audio/webm' })], 'answer.webm', {
      type: 'audio/webm',
    });
    fireEvent.change(screen.getByLabelText('Upload speaking recording'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onAnswersChange).toHaveBeenCalledWith([
        {
          questionId: 'q-speaking',
          responseMode: 'speaking_recording',
          recording: expect.objectContaining({ id: 'recording-1' }),
        },
      ]);
    });
  });

  it('renders a long-answer textarea and emits changes', () => {
    const onAnswersChange = vi.fn();
    const longAnswerAssessment = {
      ...assessment,
      sections: [
        {
          ...assessment.sections[0],
          questions: [
            {
              id: 'q-long',
              skill: 'writing',
              prompt: 'Write an essay.',
              responseMode: 'long_answer',
              media: [],
              points: 5,
            },
          ],
        },
      ],
    } as AssignmentAssessment;

    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={longAnswerAssessment}
        answers={[]}
        onAnswersChange={onAnswersChange}
      />
    );

    const textarea = screen.getByLabelText('Answer for Write an essay.');
    expect(textarea).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'My long essay content' } });

    expect(onAnswersChange).toHaveBeenCalledWith([
      {
        questionId: 'q-long',
        responseMode: 'long_answer',
        textAnswer: 'My long essay content',
      },
    ]);
  });

  it('uploads a file and emits a file_upload answer', async () => {
    const onAnswersChange = vi.fn();
    const fileAssessment = {
      ...assessment,
      sections: [
        {
          ...assessment.sections[0],
          questions: [
            {
              id: 'q-file',
              skill: 'reading',
              prompt: 'Upload research paper.',
              responseMode: 'file_upload',
              media: [],
              points: 4,
            },
          ],
        },
      ],
    } as AssignmentAssessment;

    vi.mocked(uploadAssignmentAnswerMedia).mockResolvedValueOnce({
      id: 'upload-1',
      type: 'document',
      source: 'upload',
      url: 'https://cdn.example.com/file.pdf',
      storagePath: 'assignment_answers/assignment-1/student-1/q-file/file.pdf',
    } as any);

    render(
      <StudentAssessmentRunner
        assignmentId="assignment-1"
        classId="class-1"
        assessment={fileAssessment}
        answers={[]}
        onAnswersChange={onAnswersChange}
      />
    );

    const file = new File([new Blob(['pdf content'], { type: 'application/pdf' })], 'paper.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Upload file'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onAnswersChange).toHaveBeenCalledWith([
        {
          questionId: 'q-file',
          responseMode: 'file_upload',
          uploadedFile: expect.objectContaining({ id: 'upload-1', type: 'document' }),
        },
      ]);
    });
  });
});
