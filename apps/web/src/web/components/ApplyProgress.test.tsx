// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApplyProgress } from './ApplyProgress.js';

describe('ApplyProgress', () => {
  it('announces a value-free state and reason', () => {
    render(<ApplyProgress state="ROLLBACK_FAILED" reason="ROLLBACK_FAILED" />);
    expect(screen.getByRole('heading', { name: 'ROLLBACK_FAILED' })).toBeInTheDocument();
    expect(screen.getAllByText('ROLLBACK_FAILED')).toHaveLength(2);
  });
});
