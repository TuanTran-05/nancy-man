import { queryOptions } from '@tanstack/react-query';
import { readOfficeTeachersMonth } from '../api/officeTeachersApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

/**
 * `month` is a real server parameter — the channel resolves the range and only
 * returns sessions inside it — so it belongs in the key. The search box on the
 * same page does not: it filters teachers the client already holds.
 */
export function officeTeachersMonthQueryOptions(
  identity: OfficeQueryIdentity,
  month: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: officeQueryKeys.teachersMonth(identity, month),
    queryFn: () => readOfficeTeachersMonth(month),
    enabled: enabled && Boolean(month),
    ...officeSharedQueryOptions,
  });
}
