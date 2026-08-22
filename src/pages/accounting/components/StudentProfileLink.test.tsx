// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentProfileLink } from './StudentProfileLink';

describe('StudentProfileLink', () => {
  it('links to the finance tab of the profile in a new browser tab', () => {
    render(<StudentProfileLink studentId="s1" name="Nguyễn An" />);

    const link = screen.getByRole('link', { name: 'Nguyễn An' });
    expect(link).toHaveAttribute('href', '/students/s1?tab=finance');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('escapes student ids that are not URL safe', () => {
    render(<StudentProfileLink studentId="s 1/2" name="Nguyễn An" />);

    expect(screen.getByRole('link', { name: 'Nguyễn An' })).toHaveAttribute(
      'href',
      '/students/s%201%2F2?tab=finance'
    );
  });

  it('renders plain text when the row has no student link', () => {
    render(<StudentProfileLink studentId="" name="Nguyễn An" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Nguyễn An')).toBeInTheDocument();
  });

  it('falls back to a dash when the student name is missing', () => {
    render(<StudentProfileLink studentId="" name="" />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
