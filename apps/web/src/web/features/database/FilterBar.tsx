import { useState } from 'react';
import type {
  DatabaseExplorerColumn,
  DatabaseFilterOperator,
  DatabasePageSize
} from '../../../../../packages/contracts/src/databaseExplorer.js';
import type { DatabaseFilter } from './useDatabaseExplorer.js';

export type FilterBarProps = {
  columns: DatabaseExplorerColumn[];
  filters: DatabaseFilter[];
  onAddFilter: (filter: DatabaseFilter) => void;
  onRemoveFilter: (index: number) => void;
  pageSize: DatabasePageSize;
  onPageSizeChange: (size: DatabasePageSize) => void;
  loading?: boolean;
};

const OPERATOR_LABELS: Record<DatabaseFilterOperator, string> = {
  eq: '= (bằng)',
  neq: '!= (khác)',
  contains: 'chứa (contains)',
  gt: '> (lớn hơn)',
  gte: '>= (lớn hơn hoặc bằng)',
  lt: '< (nhỏ hơn)',
  lte: '<= (nhỏ hơn hoặc bằng)',
  is_null: 'là NULL',
  is_not_null: 'không phải NULL'
};

export function FilterBar({
  columns,
  filters,
  onAddFilter,
  onRemoveFilter,
  pageSize,
  onPageSizeChange,
  loading = false
}: FilterBarProps) {
  // Only selectable, non-blocked columns with available filter operators
  const filterableColumns = columns.filter(
    (col) => col.selectable && col.classification !== 'blocked' && col.filterOperators.length > 0
  );

  const [selectedColumnName, setSelectedColumnName] = useState(filterableColumns[0]?.name ?? '');

  const selectedCol =
    filterableColumns.find((c) => c.name === selectedColumnName) ?? filterableColumns[0];
  const availableOperators = selectedCol?.filterOperators ?? [];

  const [selectedOperator, setSelectedOperator] = useState<DatabaseFilterOperator>(
    availableOperators[0] ?? 'eq'
  );
  const [filterValue, setFilterValue] = useState('');

  const isNullOperator = selectedOperator === 'is_null' || selectedOperator === 'is_not_null';
  const isMaxFilters = filters.length >= 5;

  const handleColumnChange = (name: string) => {
    setSelectedColumnName(name);
    const col = filterableColumns.find((c) => c.name === name);
    if (col && col.filterOperators.length > 0) {
      setSelectedOperator(col.filterOperators[0]);
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColumnName || !selectedOperator || isMaxFilters) return;

    if (!isNullOperator && !filterValue.trim()) return;

    onAddFilter({
      column: selectedColumnName,
      operator: selectedOperator,
      value: isNullOperator ? undefined : filterValue.slice(0, 200)
    });

    setFilterValue('');
  };

  return (
    <div className="database-filter-bar">
      {/* Top row: Filter creation form & Page size selector */}
      <div className="filter-controls-row">
        <form onSubmit={handleAdd} className="filter-form">
          <label htmlFor="filter-column-select" className="sr-only">
            Chọn cột lọc
          </label>
          <select
            id="filter-column-select"
            aria-label="Chọn cột lọc"
            value={selectedColumnName}
            onChange={(e) => handleColumnChange(e.target.value)}
            disabled={loading || filterableColumns.length === 0 || isMaxFilters}
            className="filter-select"
          >
            {filterableColumns.map((col) => (
              <option key={col.name} value={col.name}>
                {col.name}
              </option>
            ))}
          </select>

          <label htmlFor="filter-operator-select" className="sr-only">
            Toán tử lọc
          </label>
          <select
            id="filter-operator-select"
            aria-label="Toán tử lọc"
            value={selectedOperator}
            onChange={(e) => setSelectedOperator(e.target.value as DatabaseFilterOperator)}
            disabled={loading || availableOperators.length === 0 || isMaxFilters}
            className="filter-select"
          >
            {availableOperators.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op] ?? op}
              </option>
            ))}
          </select>

          <label htmlFor="filter-value-input" className="sr-only">
            Giá trị lọc
          </label>
          <input
            id="filter-value-input"
            type="text"
            placeholder={isNullOperator ? 'Không cần giá trị' : 'Giá trị lọc (tối đa 200 ký tự)'}
            value={isNullOperator ? '' : filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            maxLength={200}
            disabled={loading || isNullOperator || isMaxFilters}
            className="filter-input"
          />

          <button
            type="submit"
            disabled={
              loading ||
              isMaxFilters ||
              filterableColumns.length === 0 ||
              (!isNullOperator && !filterValue.trim())
            }
            className="primary-button compact"
          >
            {isMaxFilters ? 'Đạt tối đa 5 bộ lọc' : 'Thêm lọc'}
          </button>
        </form>

        <div className="page-size-control">
          <label htmlFor="page-size-select">Hiển thị:</label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as DatabasePageSize)}
            disabled={loading}
            className="page-size-dropdown"
          >
            <option value={25}>25 dòng</option>
            <option value={50}>50 dòng</option>
            <option value={100}>100 dòng</option>
          </select>
        </div>
      </div>

      {/* Active filter pills */}
      {filters.length > 0 && (
        <div className="active-filters-list">
          {filters.map((f, idx) => (
            <span key={`${f.column}-${f.operator}-${idx}`} className="filter-pill">
              <code>{f.column}</code> {OPERATOR_LABELS[f.operator] ?? f.operator}{' '}
              {f.value ? <strong>"{f.value}"</strong> : null}
              <button
                type="button"
                className="filter-remove-btn"
                onClick={() => onRemoveFilter(idx)}
                aria-label={`Xóa lọc ${f.column}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
