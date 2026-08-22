import { queryOptions } from '@tanstack/react-query';
import { readOfficeWeeklyDashboard } from '../api/officeDashboardApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

/**
 * The read takes no parameters: one payload holds every class, teacher and
 * student count, and the board, the visible week and all four filters are
 * derived from it on the client. That is why this key carries nothing but the
 * identity — adding the week or the filters would multiply one payload into a
 * cache entry and a network round-trip per view.
 */
export function officeWeeklyDashboardQueryOptions(identity: OfficeQueryIdentity, enabled: boolean) {
  return queryOptions({
    queryKey: officeQueryKeys.weeklyDashboard(identity),
    queryFn: () => readOfficeWeeklyDashboard(),
    enabled,
    ...officeSharedQueryOptions,
  });
}
