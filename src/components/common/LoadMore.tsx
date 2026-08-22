import React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  totalShown: number;
  totalAvailable: number;
}

export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  totalShown,
  totalAvailable,
}: LoadMoreProps) {
  const { t } = useLanguage();

  if (!hasMore) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <button
        onClick={onLoadMore}
        disabled={loading}
        className="flex items-center gap-2 px-6 py-2.5 bg-surface border border-border-default rounded-lg hover:bg-surface-alt transition-colors text-sm font-medium disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
        {loading ? t.loadMore.loading : t.loadMore.loadMore}
      </button>
      <span className="text-xs text-subtle">
        {t.loadMore.showing
          .replace('{shown}', String(totalShown))
          .replace('{available}', String(totalAvailable))}
      </span>
    </div>
  );
}

/**
 * Hook to manage client-side pagination for an array of items.
 */
export function useClientPagination<T>(
  items: T[],
  pageSize: number = 20,
  resetKey: unknown = items
) {
  const [page, setPage] = React.useState(1);

  const resetKeyRef = React.useRef(resetKey);
  React.useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const totalPages = Math.ceil(items.length / pageSize);
  const shownItems = React.useMemo(() => items.slice(0, page * pageSize), [items, page, pageSize]);
  const hasMore = page < totalPages;

  const loadMore = React.useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  return {
    shownItems,
    hasMore,
    loadMore,
    totalShown: shownItems.length,
    totalAvailable: items.length,
  };
}
