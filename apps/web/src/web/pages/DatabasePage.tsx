import { useState } from 'react';
import type { SessionInfo } from '../api.js';
import type { DatabaseTargetId } from '../../../../../packages/contracts/src/databaseExplorer.js';
import { useDatabaseExplorer } from '../features/database/useDatabaseExplorer.js';
import { PiiRevealDialog } from '../features/database/PiiRevealDialog.js';

export type DatabasePageProps = {
  session: SessionInfo;
  onUnauthorized: () => void;
};

export function DatabasePage({ session, onUnauthorized }: DatabasePageProps) {
  const {
    targets,
    selectedTargetId,
    selectTarget,
    schema,
    selectedSchemaName,
    selectedRelationName,
    selectRelation,
    currentRelation,
    activeTab,
    setActiveTab,
    rows,
    piiReveal,
    isRevealDialogOpen,
    setIsRevealDialogOpen,
    handleReveal,
    handleHide,
    loadingTargets,
    loadingSchema,
    loadingRows,
    error,
    isViewer
  } = useDatabaseExplorer({ session, onUnauthorized });

  const [schemaSearch, setSchemaSearch] = useState('');

  const currentTarget = targets.find((t) => t.id === selectedTargetId);
  const targetLabel = currentTarget?.label ?? selectedTargetId ?? 'Database';

  // Format countdown string
  const formatCountdown = (expiresAt: string | null) => {
    if (!expiresAt) return '';
    const diff = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="database-explorer-page">
      {/* Top bar: Target selector, Read-only badge, Privacy toggle */}
      <header className="database-header">
        <div className="database-target-controls">
          <div className="target-select-wrapper">
            <label htmlFor="database-target-select" className="sr-only">
              Chọn cơ sở dữ liệu
            </label>
            <select
              id="database-target-select"
              aria-label="Chọn cơ sở dữ liệu"
              value={selectedTargetId ?? ''}
              onChange={(e) => selectTarget(e.target.value as DatabaseTargetId)}
              disabled={loadingTargets}
              className="target-dropdown"
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} {t.status !== 'available' ? `(${t.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <span className="badge badge-readonly" aria-label="Chế độ chỉ đọc">
            Chỉ đọc
          </span>
        </div>

        {!isViewer && (
          <div className="database-privacy-controls">
            {piiReveal.active ? (
              <div className="privacy-active-pill">
                <span className="privacy-badge revealed">
                  PII: Đã mở khóa ({formatCountdown(piiReveal.expiresAt)})
                </span>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => void handleHide()}
                >
                  Ẩn dữ liệu nhạy cảm
                </button>
              </div>
            ) : (
              <div className="privacy-masked-pill">
                <span className="privacy-badge masked">PII: Đang ẩn (Masked)</span>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setIsRevealDialogOpen(true)}
                >
                  Mở khóa PII
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {error ? (
        <div className="database-error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="database-workspace">
        {/* Left Sidebar: Schema and Table Tree */}
        <aside className="database-sidebar" aria-label="Danh sách bảng">
          <div className="sidebar-search">
            <input
              type="search"
              aria-label="Tìm kiếm bảng hoặc view"
              placeholder="Lọc bảng..."
              value={schemaSearch}
              onChange={(e) => setSchemaSearch(e.target.value)}
              className="tree-search-input"
            />
          </div>

          <div className="sidebar-tree">
            {loadingSchema ? (
              <div className="tree-loading">Đang tải cấu trúc…</div>
            ) : (
              schema?.schemas.map((s) => {
                const filteredRelations = s.relations.filter(
                  (r) =>
                    !schemaSearch ||
                    r.name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
                    s.name.toLowerCase().includes(schemaSearch.toLowerCase())
                );
                if (filteredRelations.length === 0) return null;

                return (
                  <div key={s.name} className="tree-schema-group">
                    <div className="tree-schema-title">{s.name}</div>
                    <ul className="tree-relation-list">
                      {filteredRelations.map((r) => {
                        const isSelected =
                          s.name === selectedSchemaName && r.name === selectedRelationName;
                        return (
                          <li key={r.name}>
                            <button
                              type="button"
                              className={`tree-relation-item ${isSelected ? 'active' : ''}`}
                              onClick={() => selectRelation(s.name, r.name)}
                            >
                              <span className="relation-name">{r.name}</span>
                              {r.estimatedRows != null ? (
                                <span className="relation-count">~{r.estimatedRows}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Content Area: Tabs and Content */}
        <section className="database-main" aria-label="Nội dung cơ sở dữ liệu">
          <nav className="database-tabs" role="tablist" aria-label="Các góc nhìn">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'data'}
              className={`database-tab-btn ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              Dữ liệu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'structure'}
              className={`database-tab-btn ${activeTab === 'structure' ? 'active' : ''}`}
              onClick={() => setActiveTab('structure')}
            >
              Cấu trúc
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'relations'}
              className={`database-tab-btn ${activeTab === 'relations' ? 'active' : ''}`}
              onClick={() => setActiveTab('relations')}
            >
              Quan hệ
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'erd'}
              className={`database-tab-btn ${activeTab === 'erd' ? 'active' : ''}`}
              onClick={() => setActiveTab('erd')}
            >
              Toàn bộ ERD
            </button>
          </nav>

          <div className="database-tab-panel">
            {activeTab === 'data' && (
              <div className="data-panel-content">
                {isViewer ? (
                  <div className="empty-state viewer-restricted">
                    <h3>Quyền truy cập bị giới hạn</h3>
                    <p>
                      Role Viewer chỉ có quyền xem cấu trúc schema và quan hệ bảng. Để duyệt dữ
                      liệu, cần quyền Maintainer hoặc Owner.
                    </p>
                  </div>
                ) : loadingRows ? (
                  <div className="loading-state">Đang tải dữ liệu…</div>
                ) : rows ? (
                  <div className="data-grid-container">
                    <div className="grid-summary-bar">
                      <span>
                        Bảng{' '}
                        <strong>
                          {selectedSchemaName}.{selectedRelationName}
                        </strong>
                        : {rows.rows.length} dòng
                      </span>
                    </div>
                    {/* Bounded Data Grid view */}
                    <div className="table-responsive">
                      <table className="ops-data-table">
                        <thead>
                          <tr>
                            {rows.columns.map((col) => (
                              <th key={col.name}>{col.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.rows.map((row, idx) => (
                            <tr key={row.rowRef ?? idx}>
                              {rows.columns.map((col) => {
                                const cell = row.cells[col.name];
                                if (!cell) return <td key={col.name}>-</td>;
                                if (cell.state === 'blocked') {
                                  return (
                                    <td key={col.name} className="cell-blocked">
                                      <em>[Blocked]</em>
                                    </td>
                                  );
                                }
                                if (cell.state === 'masked') {
                                  return (
                                    <td key={col.name} className="cell-masked">
                                      {cell.display}
                                    </td>
                                  );
                                }
                                if (cell.state === 'truncated') {
                                  return (
                                    <td key={col.name} className="cell-truncated">
                                      {cell.display}
                                    </td>
                                  );
                                }
                                return (
                                  <td key={col.name}>
                                    {cell.value === null
                                      ? 'NULL'
                                      : typeof cell.value === 'object'
                                        ? JSON.stringify(cell.value)
                                        : String(cell.value)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>Chọn một bảng ở danh sách bên trái để bắt đầu duyệt dữ liệu.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'structure' && (
              <div className="structure-panel-content">
                {currentRelation ? (
                  <div className="structure-details">
                    <h3>
                      {selectedSchemaName}.{selectedRelationName}
                    </h3>
                    <table className="ops-structure-table">
                      <thead>
                        <tr>
                          <th>Cột</th>
                          <th>Kiểu dữ liệu</th>
                          <th>Nullable</th>
                          <th>Phân loại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentRelation.columns.map((col) => (
                          <tr key={col.name}>
                            <td>
                              <strong>{col.name}</strong>
                              {currentRelation.primaryKey?.includes(col.name) && (
                                <span className="badge-pk">PK</span>
                              )}
                            </td>
                            <td>{col.dataType}</td>
                            <td>{col.nullable ? 'Có' : 'Không'}</td>
                            <td>
                              <span className={`badge-classification ${col.classification}`}>
                                {col.classification === 'blocked'
                                  ? 'Never exposed'
                                  : col.classification.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">Chưa chọn quan hệ nào.</div>
                )}
              </div>
            )}

            {activeTab === 'relations' && (
              <div className="relations-panel-content">
                <h3>Quan hệ khóa ngoại của {selectedRelationName}</h3>
                {schema?.edges.filter(
                  (e) =>
                    e.from.relation === selectedRelationName ||
                    e.to.relation === selectedRelationName
                ).length === 0 ? (
                  <p>Không có quan hệ khóa ngoại nào được định nghĩa.</p>
                ) : (
                  <ul className="relation-edges-list">
                    {schema?.edges
                      .filter(
                        (e) =>
                          e.from.relation === selectedRelationName ||
                          e.to.relation === selectedRelationName
                      )
                      .map((e) => (
                        <li key={e.constraint}>
                          <strong>{e.constraint}</strong>: {e.from.schema}.{e.from.relation} (
                          {e.from.columns.join(', ')}) &rarr; {e.to.schema}.{e.to.relation} (
                          {e.to.columns.join(', ')})
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'erd' && (
              <div className="erd-panel-content">
                <h3>Toàn bộ ERD</h3>
                <p>Tổng quan cấu trúc và liên kết của tất cả các bảng trong database.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <PiiRevealDialog
        open={isRevealDialogOpen}
        targetName={targetLabel}
        onClose={() => setIsRevealDialogOpen(false)}
        onSubmit={handleReveal}
      />
    </div>
  );
}
