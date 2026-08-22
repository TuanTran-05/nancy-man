import { describe, expect, it } from 'vitest';
import {
  createInitialAuthoringUiState,
  setAuthoringActiveTab,
  toggleSettingsDrawerForTab,
  type AuthoringUiState,
} from './authoringUiState';

describe('authoringUiState', () => {
  it('starts on the questions tab with closed drawers', () => {
    expect(createInitialAuthoringUiState()).toEqual({
      activeTab: 'questions',
      previewOpen: false,
      previewDevice: 'desktop',
      settingsOpen: false,
      questionBankOpen: false,
      mediaPickerOpen: false,
      activeBlockId: null,
      focusedQuestionId: null,
      toolbarMode: 'floating',
    } satisfies AuthoringUiState);
  });

  it('opens the settings drawer when switching to settings', () => {
    const next = setAuthoringActiveTab(createInitialAuthoringUiState(), 'settings');
    expect(next.activeTab).toBe('settings');
    expect(next.settingsOpen).toBe(true);
  });

  it('closes settings when returning to questions', () => {
    const settingsState = setAuthoringActiveTab(createInitialAuthoringUiState(), 'settings');
    const next = setAuthoringActiveTab(settingsState, 'questions');
    expect(next.activeTab).toBe('questions');
    expect(next.settingsOpen).toBe(false);
  });

  it('keeps settings tab selected when the drawer toggles open', () => {
    const next = toggleSettingsDrawerForTab(createInitialAuthoringUiState(), true);
    expect(next.activeTab).toBe('settings');
    expect(next.settingsOpen).toBe(true);
  });
});
