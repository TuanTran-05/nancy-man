// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentAssessmentPreview } from './StudentAssessmentPreview';
import type { AssignmentAssessmentInput } from '../../../../shared/assignmentAssessment';

const assessment: AssignmentAssessmentInput = {
  version: 2,
  mode: 'practice',
  sections: [
    {
      id: 'listening',
      title: 'Listening',
      skill: 'listening',
      instructions: 'Listen and choose.',
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
              url: 'https://cdn.example.com/q1.mp3',
              title: 'Dialogue',
              transcript: 'Hidden transcript',
            },
          ],
          options: [
            { key: 'A', text: 'A ticket' },
            { key: 'B', text: 'A book' },
          ],
        },
      ],
    },
  ],
};

describe('StudentAssessmentPreview', () => {
  it('renders sections, media, and answer controls without transcripts', () => {
    render(<StudentAssessmentPreview assessment={assessment} />);

    expect(screen.getByRole('heading', { name: 'Listening' })).toBeInTheDocument();
    expect(screen.getByText('What does the speaker want?')).toBeInTheDocument();
    expect(screen.getByText('Dialogue')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A ticket/i })).toBeInTheDocument();
    expect(screen.queryByText('Hidden transcript')).toBeNull();
  });

  it('shows required labels and option image media', () => {
    render(
      <StudentAssessmentPreview
        assessment={{
          version: 2,
          mode: 'practice',
          sections: [
            {
              id: 'section-1',
              title: 'Images',
              skill: 'reading',
              questions: [
                {
                  id: 'question-1',
                  skill: 'reading',
                  prompt: 'Choose the park.',
                  responseMode: 'multiple_choice',
                  required: true,
                  media: [],
                  options: [
                    { key: 'A', text: 'Park' },
                    { key: 'B', text: 'Library' },
                  ],
                  optionMedia: {
                    A: [
                      {
                        id: 'media-a',
                        type: 'image',
                        source: 'external_url',
                        url: 'https://example.com/park.png',
                        altText: 'Park image',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByAltText('Park image')).toBeInTheDocument();
  });
});
