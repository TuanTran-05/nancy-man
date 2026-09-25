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
  if (!open || !edge) return null;

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="related-rows-title"
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
          <button type="button" className="close-button" onClick={onClose} aria-label="Đóng">
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
            <div className="drawer-loading">Đang tải bản ghi liên quan…</div>
          ) : !rowsResponse || rowsResponse.rows.length === 0 ? (
            <div className="drawer-empty">
              Không tìm thấy bản ghi liên quan nào cho ràng buộc này.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="ops-data-table">
                <thead>
                  <tr>
                    {rowsResponse.columns.map((col) => (
                      <th key={col.name}>{col.name}</th>
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
                              className="cell-blocked"
                              onClick={() => onOpenCellDetail(col.name, cell)}
                            >
                              [Blocked]
                            </td>
                          );
                        }

                        if (cell.state === 'masked') {
                          return (
                            <td
                              key={col.name}
                              className="cell-masked"
                              onClick={() => onOpenCellDetail(col.name, cell)}
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
                              onClick={() => onOpenCellDetail(col.name, cell)}
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
                          <td key={col.name} onClick={() => onOpenCellDetail(col.name, cell)}>
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
          <div className="drawer-count">
            {rowsResponse ? `Hiển thị ${rowsResponse.rows.length} dòng liên quan` : ''}
          </div>
          <div className="drawer-pagination">
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
              Đóng
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
