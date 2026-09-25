import { useEffect, useState } from 'react';
import type { SessionInfo } from '../api.js';
import type { DatabaseTargetId } from '../../../../../packages/contracts/src/databaseExplorer.js';
import { useDatabaseExplorer } from '../features/database/useDatabaseExplorer.js';
import { SchemaTree } from '../features/database/SchemaTree.js';
import { StructurePanel } from '../features/database/StructurePanel.js';
import { FilterBar } from '../features/database/FilterBar.js';
import { DataGrid } from '../features/database/DataGrid.js';
import { CellDetailDialog } from '../features/database/CellDetailDialog.js';
import { RelatedRowsDrawer } from '../features/database/RelatedRowsDrawer.js';
import { PiiRevealDialog } from '../features/database/PiiRevealDialog.js';
import { RelationshipGraph } from '../features/database/RelationshipGraph.js';
import { FullErd } from '../features/database/FullErd.js';

export type DatabasePageProps = {
  session: SessionInfo;
  onUnauthorized: () => void;
};

export function DatabasePage({ session, onUnauthorized }: DatabasePageProps) {
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
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
    pageSize,
    setPageSize,
    filters,
    addFilter,
    removeFilter,
    sort,
    toggleSort,
    cursorStack,
    goToNextPage,
    goToPreviousPage,
    selectedCell,
    setSelectedCell,
    relatedRowsDrawer,
    followRelation,
    closeRelatedDrawer,
    goToRelatedNextPage,
    goToRelatedPreviousPage,
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

  useEffect(() => {
    if (!piiReveal.active || !piiReveal.expiresAt) return;
    setCountdownNow(Date.now());
    const interval = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [piiReveal.active, piiReveal.expiresAt]);

  const currentTarget = targets.find((t) => t.id === selectedTargetId);
  const targetLabel = currentTarget?.label ?? selectedTargetId ?? 'Database';

  // Format countdown string
  const formatCountdown = (expiresAt: string | null) => {
    if (!expiresAt) return '';
    const diff = Math.max(0, Math.floor((Date.parse(expiresAt) - countdownNow) / 1000));
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
                <span
                  className="privacy-badge revealed"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
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
        {/* Left Sidebar: Schema Tree */}
        <aside className="database-sidebar" aria-label="Danh sách bảng">
          <SchemaTree
            schemas={schema?.schemas ?? []}
            selectedSchema={selectedSchemaName}
            selectedRelation={selectedRelationName}
            onSelectRelation={selectRelation}
            loading={loadingSchema}
          />
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
                ) : (
                  <>
                    <FilterBar
                      columns={currentRelation?.columns ?? []}
                      filters={filters}
                      onAddFilter={addFilter}
                      onRemoveFilter={removeFilter}
                      pageSize={pageSize}
                      onPageSizeChange={setPageSize}
                      loading={loadingRows}
                    />

                    <DataGrid
                      rowsResponse={rows}
                      loading={loadingRows}
                      sort={sort}
                      onSortChange={toggleSort}
                      onNextPage={goToNextPage}
                      onPreviousPage={goToPreviousPage}
                      hasPreviousPage={cursorStack.length > 0}
                      hasNextPage={Boolean(rows?.nextCursor)}
                      edges={schema?.edges ?? []}
                      onOpenCellDetail={(column, cell) =>
                        setSelectedCell({ rowRef: null, column, cell })
                      }
                      onFollowRelation={followRelation}
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'structure' && (
              <div className="structure-panel-content">
                <StructurePanel schemaName={selectedSchemaName} relation={currentRelation} />
              </div>
            )}

            {activeTab === 'relations' && (
              <div className="relations-panel-content">
                {schema && selectedSchemaName && selectedRelationName ? (
                  <RelationshipGraph
                    snapshot={schema}
                    targetId={selectedTargetId ?? ''}
                    selectedSchema={selectedSchemaName}
                    selectedRelation={selectedRelationName}
                    onSelectRelation={(schema, relation) => selectRelation(schema, relation)}
                  />
                ) : (
                  <div className="empty-state">
                    <p>Chọn một bảng để xem quan hệ khóa ngoại.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'erd' && (
              <div className="erd-panel-content">
                {schema ? (
                  <FullErd
                    snapshot={schema}
                    targetId={selectedTargetId ?? ''}
                    onSelectRelation={(schemaName, relation) => {
                      selectRelation(schemaName, relation);
                      setActiveTab('data');
                    }}
                  />
                ) : (
                  <div className="empty-state">
                    <p>Chọn một target để xem ERD toàn bộ.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Cell Detail Dialog */}
      <CellDetailDialog
        open={Boolean(selectedCell)}
        columnName={selectedCell?.column ?? ''}
        cell={selectedCell?.cell ?? null}
        onClose={() => setSelectedCell(null)}
      />

      {/* Related Rows Drawer */}
      <RelatedRowsDrawer
        open={Boolean(relatedRowsDrawer?.open)}
        edge={relatedRowsDrawer?.edge ?? null}
        sourceRowRef={relatedRowsDrawer?.rowRef ?? null}
        rowsResponse={relatedRowsDrawer?.rows ?? null}
        loading={relatedRowsDrawer?.loading}
        error={relatedRowsDrawer?.error}
        onClose={closeRelatedDrawer}
        onNextPage={goToRelatedNextPage}
        onPreviousPage={goToRelatedPreviousPage}
        hasPreviousPage={Boolean(relatedRowsDrawer?.cursorStack.length)}
        hasNextPage={Boolean(relatedRowsDrawer?.rows?.nextCursor)}
        onOpenCellDetail={(column, cell) => setSelectedCell({ rowRef: null, column, cell })}
      />

      {/* PII Reveal Step-Up Dialog */}
      <PiiRevealDialog
        open={isRevealDialogOpen}
        targetName={targetLabel}
        onClose={() => setIsRevealDialogOpen(false)}
        onSubmit={handleReveal}
      />
    </div>
  );
}
