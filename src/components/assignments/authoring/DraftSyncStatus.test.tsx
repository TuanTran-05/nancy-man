// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DraftSyncStatus } from './DraftSyncStatus';

describe('DraftSyncStatus', () => {
  it('uses Forms-style autosave labels', () => {
    render(<DraftSyncStatus status="syncing" />);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('shows saved when synced', () => {
    render(<DraftSyncStatus status="synced" />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
