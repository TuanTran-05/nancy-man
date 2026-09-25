import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import type {
  DatabaseCell,
  DatabaseRelationEdge,
  DatabaseRowsResponse
} from '../../../../../../packages/contracts/src/databaseExplorer.js';

export type RelatedRowsDrawerProps = {
  open: boolean;
  edge: DatabaseRelationEdge | null;
  sourceRowRef: string | null;
  rowsResponse: DatabaseRowsResponse | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onOpenCellDetail: (column: string, cell: DatabaseCell) => void;
};

export function RelatedRowsDrawer({
  open,
  edge,
  rowsResponse,
  loading = false,
  error,
  onClose,
  onNextPage,
  onPreviousPage,
  hasPreviousPage,
  hasNextPage,
  onOpenCellDetail
}: RelatedRowsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !edge) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, edge, onClose]);

  const activateCell = (
    event: KeyboardEvent<HTMLTableCellElement>,
    column: string,
    cell: DatabaseCell
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenCellDetail(column, cell);
    }
  };
  const preventNonCopyableCellCopy = (event: ClipboardEvent<HTMLTableCellElement>) => {
    event.preventDefault();
  };

  if (!open || !edge) return null;

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="related-rows-title"
      tabIndex={-1}
      ref={drawerRef}
    >
      <div className="drawer-content">
        <header className="drawer-header">
          <div>
            <h2 id="related-rows-title">Bản ghi liên quan qua {edge.constraint}</h2>
            <p className="drawer-relation-path">
              {edge.from.schema}.{edge.from.relation} ({edge.from.columns.join(', ')}) &rarr;{' '}
              {edge.to.schema}.{edge.to.relation} ({edge.to.columns.join(', ')})
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Đóng"
          >
            ✕
          </button>
        </header>

        {error ? (
          <div className="drawer-error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <div className="drawer-body">
          {loading ? (
            <div className="drawer-loading" role="status" aria-live="polite">
              Đang tải bản ghi liên quan…
            </div>
          ) : !rowsResponse || rowsResponse.rows.length === 0 ? (
            <div className="drawer-empty" role="status" aria-live="polite">
              Không tìm thấy bản ghi liên quan nào cho ràng buộc này.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="ops-data-table" aria-label="Bản ghi liên quan">
                <thead>
                  <tr>
                    {rowsResponse.columns.map((col) => (
                      <th key={col.name} scope="col">
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsResponse.rows.map((row, rowIdx) => (
                    <tr key={row.rowRef ?? rowIdx}>
                      {rowsResponse.columns.map((col) => {
                        const cell = row.cells[col.name];
                        if (!cell) return <td key={col.name}>-</td>;

                        if (cell.state === 'blocked') {
                          return (
                            <td
                              key={col.name}
                              className="cell-blocked cell-non-copyable"
                              tabIndex={0}
                              aria-label={`${col.name}: blocked`}
                              onClick={() => onOpenCellDetail(col.name, cell)}
                              onKeyDown={(event) => activateCell(event, col.name, cell)}
                              onCopy={preventNonCopyableCellCopy}
                            >
                              [Blocked]
                            </td>
                          );
                        }

                        if (cell.state === 'masked') {
                          return (
                            <td
                              key={col.name}
                              className="cell-masked cell-non-copyable"
                              tabIndex={0}
                              aria-label={`${col.name}: masked value ${cell.display}`}
                              onClick={() => onOpenCellDetail(col.name, cell)}
                              onKeyDown={(event) => activateCell(event, col.name, cell)}
                              onCopy={preventNonCopyableCellCopy}
                            >
                              {cell.display}
                            </td>
                          );
                        }

                        if (cell.state === 'truncated') {
                          return (
                            <td
                              key={col.name}
                              className="cell-truncated"
                              tabIndex={0}
                              aria-label={`${col.name}: truncated value ${cell.display}`}
                              onClick={() => onOpenCellDetail(col.name, cell)}
                              onKeyDown={(event) => activateCell(event, col.name, cell)}
                            >
                              {cell.display}…
                            </td>
                          );
                        }

                        const displayVal =
                          cell.value === null
                            ? 'NULL'
                            : typeof cell.value === 'object'
                              ? JSON.stringify(cell.value)
                              : String(cell.value);

                        return (
                          <td
                            key={col.name}
                            tabIndex={0}
                            aria-label={`${col.name}: ${displayVal}`}
                            onClick={() => onOpenCellDetail(col.name, cell)}
                            onKeyDown={(event) => activateCell(event, col.name, cell)}
                          >
                            {displayVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="drawer-footer">
          <div className="drawer-count" aria-live="polite">
            {rowsResponse ? `Hiển thị ${rowsResponse.rows.length} dòng liên quan` : ''}
          </div>
          <div className="drawer-pagination" role="group" aria-label="Phân trang bản ghi liên quan">
            <button
              type="button"
              className="secondary-button compact"
              onClick={onPreviousPage}
              disabled={!hasPreviousPage || loading}
            >
              Trang trước
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={onNextPage}
              disabled={!hasNextPage || loading}
            >
              Trang sau
            </button>
            <button type="button" className="primary-button compact" onClick={onClose}>
              Đóng ngăn
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
