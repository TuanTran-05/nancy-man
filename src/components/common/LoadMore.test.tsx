// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { LoadMore, useClientPagination } from './LoadMore';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: {
      loadMore: {
        loadMore: 'Load More',
        loading: 'Loading...',
        showing: 'Showing {shown} of {available}',
      },
    },
  }),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: () => null,
  Loader2: () => null,
}));

describe('LoadMore component', () => {
  it('returns null when hasMore is false', () => {
    const { container } = render(
      <LoadMore
        hasMore={false}
        loading={false}
        onLoadMore={vi.fn()}
        totalShown={10}
        totalAvailable={10}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders button when hasMore is true', () => {
    render(
      <LoadMore
        hasMore={true}
        loading={false}
        onLoadMore={vi.fn()}
        totalShown={10}
        totalAvailable={20}
      />
    );
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('button is disabled when loading', () => {
    render(
      <LoadMore
        hasMore={true}
        loading={true}
        onLoadMore={vi.fn()}
        totalShown={10}
        totalAvailable={20}
      />
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('click calls onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(
      <LoadMore
        hasMore={true}
        loading={false}
        onLoadMore={onLoadMore}
        totalShown={10}
        totalAvailable={20}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows correct count text', () => {
    render(
      <LoadMore
        hasMore={true}
        loading={false}
        onLoadMore={vi.fn()}
        totalShown={10}
        totalAvailable={25}
      />
    );
    expect(screen.getByText('Showing 10 of 25')).toBeDefined();
  });
});

describe('useClientPagination hook', () => {
  const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);

  it('initial page shows first pageSize items', () => {
    const { result } = renderHook(() => useClientPagination(items, 10));
    expect(result.current.shownItems).toHaveLength(10);
    expect(result.current.shownItems[0]).toBe('item-0');
    expect(result.current.hasMore).toBe(true);
    expect(result.current.totalShown).toBe(10);
    expect(result.current.totalAvailable).toBe(50);
  });

  it('loadMore increases shown items', () => {
    const { result } = renderHook(() => useClientPagination(items, 10));
    expect(result.current.shownItems).toHaveLength(10);

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.shownItems).toHaveLength(20);
    expect(result.current.totalShown).toBe(20);
  });

  it('does not reset when a caller passes a new array with the same reset key', () => {
    const { result, rerender } = renderHook(
      ({ tick }) => useClientPagination([...items], 10, 'stable-filter'),
      { initialProps: { tick: 0 } }
    );

    act(() => {
      result.current.loadMore();
    });
    expect(result.current.shownItems).toHaveLength(20);

    rerender({ tick: 1 });
    expect(result.current.shownItems).toHaveLength(20);
  });

  it('resets when reset key changes even if item count is unchanged', () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useClientPagination([...items], 10, resetKey),
      { initialProps: { resetKey: 'active' } }
    );

    act(() => {
      result.current.loadMore();
    });
    expect(result.current.shownItems).toHaveLength(20);

    rerender({ resetKey: 'all' });
    expect(result.current.shownItems).toHaveLength(10);
  });

  it('keeps the same shownItems array reference across unrelated re-renders', () => {
    const stableItems = [...items];
    const { result, rerender } = renderHook(() => useClientPagination(stableItems, 10), {
      initialProps: {},
    });

    const firstShownItems = result.current.shownItems;
    // Re-render with no change to items/page — simulates an unrelated state
    // update elsewhere in the parent (e.g. an async image finishing loading).
    rerender();

    expect(result.current.shownItems).toBe(firstShownItems);
  });

  it('resets when items.length changes', () => {
    let currentItems = [...items];
    const { result, rerender } = renderHook(
      ({ items, pageSize }) => useClientPagination(items, pageSize),
      { initialProps: { items: currentItems, pageSize: 10 } }
    );

    // Load more to get to page 2
    act(() => {
      result.current.loadMore();
    });
    expect(result.current.shownItems).toHaveLength(20);

    // Change items length to trigger reset
    currentItems = Array.from({ length: 5 }, (_, i) => `new-item-${i}`);
    rerender({ items: currentItems, pageSize: 10 });

    expect(result.current.shownItems).toHaveLength(5);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.totalAvailable).toBe(5);
  });
});
