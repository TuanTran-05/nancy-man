import { useQuery } from '@tanstack/react-query';
import { KnowledgeBankItem } from '../types';
import { FRONTEND_COLLECTION_LIMIT } from '../lib/api/readLimits';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../lib/api/frontendReadApi';
import { readChannel } from '../lib/api/readApi';

export function useKnowledgeBankItems() {
  const query = useQuery({
    queryKey: ['read', 'knowledge-bank'],
    queryFn: () =>
      readChannel<{ items: KnowledgeBankItem[] }>('knowledge-bank', {
        limit: FRONTEND_COLLECTION_LIMIT,
      }),
    refetchInterval: FRONTEND_READ_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return { items: query.data?.items || [], loading: query.isPending };
}
