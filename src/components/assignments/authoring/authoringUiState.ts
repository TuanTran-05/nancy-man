export type AuthoringActiveTab = 'questions' | 'responses' | 'settings';
export type AuthoringPreviewDevice = 'desktop' | 'mobile';
export type AuthoringToolbarMode = 'floating' | 'bottom';

export interface AuthoringUiState {
  activeTab: AuthoringActiveTab;
  previewOpen: boolean;
  previewDevice: AuthoringPreviewDevice;
  settingsOpen: boolean;
  questionBankOpen: boolean;
  mediaPickerOpen: boolean;
  activeBlockId: string | null;
  focusedQuestionId: string | null;
  toolbarMode: AuthoringToolbarMode;
}

export function createInitialAuthoringUiState(): AuthoringUiState {
  return {
    activeTab: 'questions',
    previewOpen: false,
    previewDevice: 'desktop',
    settingsOpen: false,
    questionBankOpen: false,
    mediaPickerOpen: false,
    activeBlockId: null,
    focusedQuestionId: null,
    toolbarMode: 'floating',
  };
}

export function setAuthoringActiveTab(
  state: AuthoringUiState,
  activeTab: AuthoringActiveTab
): AuthoringUiState {
  return {
    ...state,
    activeTab,
    settingsOpen: activeTab === 'settings',
  };
}

export function toggleSettingsDrawerForTab(
  state: AuthoringUiState,
  settingsOpen: boolean
): AuthoringUiState {
  return {
    ...state,
    activeTab: settingsOpen
      ? 'settings'
      : state.activeTab === 'settings'
        ? 'questions'
        : state.activeTab,
    settingsOpen,
  };
}

export function openPreview(
  state: AuthoringUiState,
  previewDevice: AuthoringPreviewDevice = state.previewDevice
): AuthoringUiState {
  return { ...state, previewOpen: true, previewDevice };
}

export function closePreview(state: AuthoringUiState): AuthoringUiState {
  return { ...state, previewOpen: false };
}
