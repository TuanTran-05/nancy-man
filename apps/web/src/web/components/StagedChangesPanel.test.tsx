// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StagedChangesPanel } from './StagedChangesPanel.js';

describe('StagedChangesPanel', () => {
  afterEach(cleanup);

  it('shows value-free impact actions and checks', () => {
    render(
      <StagedChangesPanel
        change={{
          changeId: 'CHG_1',
          appId: 'edutrack',
          reason: 'reason',
          state: 'READY',
          impactPlan: {
            applicationId: 'edutrack',
            sourceIds: ['edutrack.shared_env'],
            actionIds: ['release.build_redeploy'],
            checkIds: ['release.identity'],
            strategies: ['build_redeploy'],
            counts: { items: 1, sets: 1, deletes: 0, sources: 1 },
            warnings: [],
            expectedEffect: 'build_redeploy'
          }
        }}
        onValidate={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText(/release\.build_redeploy/)).toBeInTheDocument();
    expect(screen.getByText(/release\.identity/)).toBeInTheDocument();
  });

  it('keeps apply disabled until the saved state', () => {
    const onApply = vi.fn();
    render(
      <StagedChangesPanel
        change={{ changeId: 'CHG_1', appId: 'edutrack', reason: 'reason', state: 'READY' }}
        onValidate={vi.fn()}
        onApply={onApply}
      />
    );
    const button = screen.getByRole('button', { name: 'Áp dụng' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });
});
