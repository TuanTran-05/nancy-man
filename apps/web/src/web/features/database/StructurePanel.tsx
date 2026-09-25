import type { DatabaseExplorerRelation } from '../../../../../../packages/contracts/src/databaseExplorer.js';

export type StructurePanelProps = {
  schemaName?: string | null;
  relation: DatabaseExplorerRelation | null;
};

export function StructurePanel({ schemaName, relation }: StructurePanelProps) {
  if (!relation) {
    return (
      <div className="structure-panel empty">
        <p>Chưa chọn bảng hoặc view nào.</p>
      </div>
    );
  }

  const fullName = schemaName ? `${schemaName}.${relation.name}` : relation.name;

  return (
    <div className="structure-panel" aria-label={`Cấu trúc bảng ${fullName}`}>
      <header className="structure-header">
        <div className="structure-title-row">
          <h2 className="structure-title">{fullName}</h2>
          <span className="structure-kind-badge">{relation.kind}</span>
        </div>

        <div className="structure-metadata-pills">
          <span className="metadata-pill">
            RLS: {relation.rowLevelSecurity.enabled ? 'Bật' : 'Tắt'}
          </span>
          {relation.estimatedRows != null && (
            <span className="metadata-pill">~{relation.estimatedRows} dòng</span>
          )}
          {relation.primaryKey && (
            <span className="metadata-pill">Khóa chính: {relation.primaryKey.join(', ')}</span>
          )}
          {relation.paginationKey && (
            <span className="metadata-pill">
              Keyset pagination: {relation.paginationKey.join(', ')}
            </span>
          )}
        </div>
      </header>

      {/* Columns Section */}
      <section className="structure-section">
        <h3>Danh sách cột ({relation.columns.length})</h3>
        <div className="table-responsive">
          <table className="ops-structure-table">
            <thead>
              <tr>
                <th>Tên cột</th>
                <th>Kiểu dữ liệu</th>
                <th>Nullable</th>
                <th>Mặc định / Khác</th>
                <th>Phân loại truy cập</th>
              </tr>
            </thead>
            <tbody>
              {relation.columns.map((col) => {
                const isPk = relation.primaryKey?.includes(col.name);

                return (
                  <tr key={col.name}>
                    <td>
                      <code className="column-name">{col.name}</code>
                      {isPk && <span className="badge-pill pk">PK</span>}
                    </td>
                    <td>
                      <code className="column-type">{col.dataType}</code>
                    </td>
                    <td>{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                    <td>
                      {col.hasDefault ? 'Default' : ''}
                      {col.generated ? ' Generated' : ''}
                      {col.identity ? ` Identity (${col.identity})` : ''}
                    </td>
                    <td>
                      <span className={`badge-classification ${col.classification}`}>
                        {col.classification === 'blocked'
                          ? 'Never exposed'
                          : col.classification.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Constraints Section */}
      {relation.constraints.length > 0 && (
        <section className="structure-section">
          <h3>Ràng buộc (Constraints)</h3>
          <ul className="structure-list">
            {relation.constraints.map((c) => (
              <li key={c.name} className="structure-list-item">
                <strong>{c.name}</strong> <em>({c.kind})</em>:{' '}
                <code>
                  {c.columns.join(', ')}
                  {c.referencedRelation
                    ? ` -> ${c.referencedRelation.schema}.${c.referencedRelation.name}(${c.referencedRelation.columns.join(', ')})`
                    : ''}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Indexes Section */}
      {relation.indexes.length > 0 && (
        <section className="structure-section">
          <h3>Chỉ mục (Indexes)</h3>
          <ul className="structure-list">
            {relation.indexes.map((idx) => (
              <li key={idx.name} className="structure-list-item">
                <strong>{idx.name}</strong>:{' '}
                <code>
                  {idx.method} ({idx.columns.join(', ')}){idx.unique ? ' [UNIQUE]' : ''}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Triggers Section */}
      {relation.triggers.length > 0 && (
        <section className="structure-section">
          <h3>Triggers</h3>
          <ul className="structure-list">
            {relation.triggers.map((trg) => (
              <li key={trg.name} className="structure-list-item">
                <strong>{trg.name}</strong>:{' '}
                <code>
                  {trg.timing} {trg.events.join('/')} ({trg.enabled})
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* RLS Policies Section */}
      {relation.policies.length > 0 && (
        <section className="structure-section">
          <h3>Chính sách RLS (Row Level Security Policies)</h3>
          <ul className="structure-list">
            {relation.policies.map((p) => (
              <li key={p.name} className="structure-list-item">
                <strong>{p.name}</strong> [{p.command}] &rarr; Roles: {p.roles.join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
