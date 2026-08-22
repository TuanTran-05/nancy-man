import { queryOptions } from '@tanstack/react-query';
import { readChannel } from '../../lib/api/readApi';
import type { Class } from '../../types';
import { FINANCE_PAGE_LIMIT } from './constants';

export const FINANCE_REFERENCE_STALE_TIME_MS = 15 * 60_000;
export const FINANCE_REFERENCE_GC_TIME_MS = 30 * 60_000;

type FinanceReferenceIdentity = {
  uid: string;
  role: string;
};

export type FinanceTeacherOption = { uid: string; displayName: string };

/**
 * Class and teacher lists only feed the filter dropdowns, so they can hold a
 * long staleTime — unlike the ledger, receipt and expense lists on the same
 * page, which are what accounting collects against and must not go stale.
 *
 * The keys carry identity because the `finance` channel is scoped by the
 * caller's role and `queryClient` is a module-level singleton that outlives
 * sign-out.
 */
const sharedReferenceOptions = {
  staleTime: FINANCE_REFERENCE_STALE_TIME_MS,
  gcTime: FINANCE_REFERENCE_GC_TIME_MS,
  refetchInterval: FINANCE_REFERENCE_STALE_TIME_MS,
  refetchIntervalInBackground: false,
  retry: false,
} as const;

export const financeReferenceQueryKeys = {
  classes: ({ uid, role }: FinanceReferenceIdentity) =>
    ['finance-reference', uid, role, 'classes'] as const,
  teachers: ({ uid, role }: FinanceReferenceIdentity) =>
    ['finance-reference', uid, role, 'teachers'] as const,
};

export function financeClassesQueryOptions(identity: FinanceReferenceIdentity, enabled: boolean) {
  return queryOptions({
    queryKey: financeReferenceQueryKeys.classes(identity),
    queryFn: async () => {
      const data = await readChannel<{ classes?: Class[] }>('finance', {
        resource: 'classes',
        limit: FINANCE_PAGE_LIMIT,
      });
      return data.classes || [];
    },
    enabled,
    ...sharedReferenceOptions,
  });
}

export function financeTeachersQueryOptions(identity: FinanceReferenceIdentity, enabled: boolean) {
  return queryOptions({
    queryKey: financeReferenceQueryKeys.teachers(identity),
    queryFn: async () => {
      const data = await readChannel<{ teachers?: FinanceTeacherOption[] }>('finance', {
        resource: 'teachers',
        limit: FINANCE_PAGE_LIMIT,
      });
      return data.teachers || [];
    },
    enabled,
    ...sharedReferenceOptions,
  });
}
