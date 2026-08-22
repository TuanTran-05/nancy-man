import { create } from 'zustand';

export type CourseClosingRecordStatusFilter =
  | 'all'
  | 'complete'
  | 'missing_evaluation'
  | 'missing_tuition'
  | 'not_requested'
  | 'ready'
  | 'pending'
  | 'retrying'
  | 'failed';

export type CourseClosingRecordDocumentTypeFilter = 'all' | 'evaluation' | 'tuition';

interface CourseClosingRecordsState {
  month: string;
  searchQuery: string;
  submittedSearchQuery: string;
  statusFilter: CourseClosingRecordStatusFilter;
  documentTypeFilter: CourseClosingRecordDocumentTypeFilter;
  setMonth: (month: string) => void;
  setSearchQuery: (query: string) => void;
  submitSearchQuery: () => void;
  setStatusFilter: (filter: CourseClosingRecordStatusFilter) => void;
  setDocumentTypeFilter: (filter: CourseClosingRecordDocumentTypeFilter) => void;
  resetFilters: () => void;
}

const initialMonth = new Date().toISOString().slice(0, 7);

export const useCourseClosingRecordsStore = create<CourseClosingRecordsState>((set) => ({
  month: initialMonth,
  searchQuery: '',
  submittedSearchQuery: '',
  statusFilter: 'all',
  documentTypeFilter: 'all',
  setMonth: (month) => set({ month }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  submitSearchQuery: () => set((state) => ({ submittedSearchQuery: state.searchQuery.trim() })),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setDocumentTypeFilter: (documentTypeFilter) => set({ documentTypeFilter }),
  resetFilters: () =>
    set({
      searchQuery: '',
      submittedSearchQuery: '',
      statusFilter: 'all',
      documentTypeFilter: 'all',
    }),
}));
