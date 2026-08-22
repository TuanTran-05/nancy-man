import { queryOptions } from '@tanstack/react-query';
import type { PrintRequest, PrintRequestStatus } from '../../types';
import { FRONTEND_COLLECTION_LIMIT } from '../api/readLimits';
import { readChannel } from '../api/readApi';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../api/frontendReadApi';
import { officeQueryKeys } from './officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from './officeQueryPolicy';

export interface OfficePrintRequestsFilters {
  createdDate?: string;
  neededDate?: string;
  status?: PrintRequestStatus | 'all';
}

export function officePrintRequestsQueryOptions(
  identity: OfficeQueryIdentity,
  filters: OfficePrintRequestsFilters = {},
  enabled: boolean = true
) {
  const { createdDate = '', neededDate = '', status = 'all' } = filters;
  return queryOptions<PrintRequest[]>({
    queryKey: officeQueryKeys.printRequestsList(identity, createdDate, neededDate, status),
    queryFn: async () => {
      const payload = await readChannel<{ requests: PrintRequest[] }>('print-requests', {
        createdDate,
        neededDate,
        status: status === 'all' ? undefined : status,
        limit: FRONTEND_COLLECTION_LIMIT,
      });
      return payload.requests || [];
    },
    enabled: enabled && Boolean(identity.uid && identity.role),
    refetchInterval: FRONTEND_READ_POLL_INTERVAL_MS,
    ...officeSharedQueryOptions,
  });
}
