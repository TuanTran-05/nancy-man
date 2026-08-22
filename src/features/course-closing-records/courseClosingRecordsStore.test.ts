import { beforeEach, describe, expect, it } from 'vitest';
import { useCourseClosingRecordsStore } from './courseClosingRecordsStore.js';

describe('courseClosingRecordsStore', () => {
  beforeEach(() => {
    useCourseClosingRecordsStore.getState().resetFilters();
  });

  it('initializes with default state', () => {
    const state = useCourseClosingRecordsStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.statusFilter).toBe('all');
    expect(state.documentTypeFilter).toBe('all');
  });

  it('updates state and resets filters', () => {
    useCourseClosingRecordsStore.getState().setSearchQuery('An');
    useCourseClosingRecordsStore.getState().setStatusFilter('ready');
    useCourseClosingRecordsStore.getState().setDocumentTypeFilter('evaluation');

    let state = useCourseClosingRecordsStore.getState();
    expect(state.searchQuery).toBe('An');
    expect(state.statusFilter).toBe('ready');
    expect(state.documentTypeFilter).toBe('evaluation');

    useCourseClosingRecordsStore.getState().resetFilters();
    state = useCourseClosingRecordsStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.statusFilter).toBe('all');
    expect(state.documentTypeFilter).toBe('all');
  });
});
