/**
 * Office pages are unmounted by `AnimatedRoutes` on every tab switch, so the
 * cache — not the component — owns the lifetime of fetched data. These are the
 * same constants the student directory, finance reference and payroll modules
 * already use; keeping one number across all of them is what makes "everything
 * is fresh for fifteen minutes" a statement someone can rely on.
 */
export const OFFICE_QUERY_STALE_TIME_MS = 15 * 60_000;
export const OFFICE_QUERY_GC_TIME_MS = 30 * 60_000;

export type OfficeQueryIdentity = {
  uid: string;
  role: string;
};

/**
 * `refetchIntervalInBackground: false` is the reason a hidden tab costs
 * nothing: TanStack Query suspends the interval while the document is hidden
 * and resumes it on focus.
 */
export const officeSharedQueryOptions = {
  staleTime: OFFICE_QUERY_STALE_TIME_MS,
  gcTime: OFFICE_QUERY_GC_TIME_MS,
  refetchInterval: OFFICE_QUERY_STALE_TIME_MS,
  refetchIntervalInBackground: false,
  retry: false,
} as const;
