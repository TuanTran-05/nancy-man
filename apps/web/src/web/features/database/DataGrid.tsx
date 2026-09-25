import type {
  DatabaseCell,
  DatabaseRelationEdge,
  DatabaseRowsResponse
} from '../../../../../../packages/contracts/src/databaseExplorer.js';
import type { DatabaseSort } from './useDatabaseExplorer.js';

export type DataGridProps = {
  rowsResponse: DatabaseRowsResponse | null;
  loading?: boolean;
  sort?: DatabaseSort;
  onSortChange: (column: string) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  edges?: DatabaseRelationEdge[];
  onOpenCellDetail: (column: string, cell: DatabaseCell) => void;
  onFollowRelation: (edge: DatabaseRelationEdge, rowRef: string) => void;
};

export function DataGrid({
  rowsResponse,
  loading = false,
  sort,
  onSortChange,
  onNextPage,
  onPreviousPage,
  hasPreviousPage,
  hasNextPage,
  edges = [],
  onOpenCellDetail,
  onFollowRelation
}: DataGridProps) {
  if (loading) {
    return (
      <div className="data-grid-shell">
        <div className="data-grid-loading">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (!rowsResponse) {
    return (
      <div className="data-grid-shell">
        <div className="data-grid-empty">Chưa có dữ liệu. Vui lòng chọn bảng để bắt đầu.</div>
      </div>
    );
  }

  const { columns, rows, relation, consistency } = rowsResponse;

  // Filter edges related to this relation (either from or to this relation)
  const relatedEdges = edges.filter(
    (e) => e.from.relation === relation || e.to.relation === relation
  );

  return (
    <div className="data-grid-shell">
      {/* Consistency warning if best-effort offset pagination */}
      {consistency === 'best_effort' && (
        <div className="consistency-warning" role="alert">
          <span className="warning-icon">⚠️</span>
          <span>
            Bảng không có khóa chính hoặc unique index hợp lệ. Phân trang sử dụng phương thức
            best-effort (offset), dữ liệu có thể trùng hoặc sót khi có cập nhật song song.
          </span>
        </div>
      )}

      {/* Grid container with horizontal scroll */}
      <div className="data-grid-table-container">
        <table className="ops-data-grid-table" aria-label={`Dữ liệu bảng ${relation}`}>
          <thead>
            <tr>
              {relatedEdges.length > 0 && (
                <th className="th-fk-actions" scope="col">
                  Quan hệ FK
                </th>
              )}
              {columns.map((col) => {
                const isCurrentSort = sort?.column === col.name;
                const ariaSort = isCurrentSort
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';

                return (
                  <th key={col.name} scope="col" aria-sort={ariaSort}>
                    <button
                      type="button"
                      className="th-sort-button"
                      onClick={() => onSortChange(col.name)}
                      aria-label={`Sắp xếp theo ${col.name}`}
                    >
                      <span className="th-name">{col.name}</span>
                      <span className="th-sort-icon">
                        {isCurrentSort ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (relatedEdges.length > 0 ? 1 : 0)}
                  className="td-empty"
                >
                  Không có dòng nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIdx) => {
                return (
                  <tr key={row.rowRef ?? rowIdx} className="grid-row">
                    {/* FK Navigation button cell */}
                    {relatedEdges.length > 0 && (
                      <td className="td-fk-cell">
                        {row.rowRef ? (
                          <div className="fk-buttons-group">
                            {relatedEdges.map((edge) => {
                              const targetRel =
                                edge.from.relation === relation
                                  ? edge.to.relation
                                  : edge.from.relation;

                              return (
                                <button
                                  key={edge.constraint}
                                  type="button"
                                  className="fk-nav-btn"
                                  onClick={() => onFollowRelation(edge, row.rowRef!)}
                                  aria-label={`Xem quan hệ ${edge.constraint} với ${targetRel}`}
                                >
                                  &rarr; {targetRel}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    )}

                    {/* Column cells */}
                    {columns.map((col) => {
                      const cell = row.cells[col.name];
                      if (!cell) return <td key={col.name}>-</td>;

                      if (cell.state === 'blocked') {
                        return (
                          <td
                            key={col.name}
                            className="td-cell cell-blocked"
                            onClick={() => onOpenCellDetail(col.name, cell)}
                          >
                            <span className="blocked-tag">[Blocked]</span>
                          </td>
                        );
                      }

                      if (cell.state === 'masked') {
                        return (
                          <td
                            key={col.name}
                            className="td-cell cell-masked"
                            onClick={() => onOpenCellDetail(col.name, cell)}
                          >
                            <span className="masked-text">{cell.display}</span>
                          </td>
                        );
                      }

                      if (cell.state === 'truncated') {
                        return (
                          <td
                            key={col.name}
                            className="td-cell cell-truncated"
                            onClick={() => onOpenCellDetail(col.name, cell)}
                          >
                            <span className="truncated-text">{cell.display}</span>
                            <span className="truncated-badge">…</span>
                          </td>
                        );
                      }

                      // cell.state === 'value'
                      const displayValue =
                        cell.value === null
                          ? 'NULL'
                          : typeof cell.value === 'object'
                            ? JSON.stringify(cell.value)
                            : String(cell.value);

                      return (
                        <td
                          key={col.name}
                          className={`td-cell ${cell.value === null ? 'cell-null' : ''}`}
                          onClick={() => onOpenCellDetail(col.name, cell)}
                        >
                          <span className="cell-value-text">{displayValue}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Grid footer with pagination controls */}
      <footer className="data-grid-footer">
        <div className="grid-count-info">
          <span>Hiển thị {rows.length} dòng</span>
        </div>

        <div className="grid-pagination-controls">
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
        </div>
      </footer>
    </div>
  );
}
