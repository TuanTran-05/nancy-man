import { useMemo, useState } from 'react';
import type { DatabaseExplorerSchema } from '../../../../../packages/contracts/src/databaseExplorer.js';

export type SchemaTreeProps = {
  schemas: DatabaseExplorerSchema[];
  selectedSchema: string | null;
  selectedRelation: string | null;
  onSelectRelation: (schema: string, relation: string) => void;
  loading?: boolean;
};

export function SchemaTree({
  schemas,
  selectedSchema,
  selectedRelation,
  onSelectRelation,
  loading = false
}: SchemaTreeProps) {
  const [search, setSearch] = useState('');

  const filteredSchemas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schemas;

    return schemas
      .map((s) => ({
        ...s,
        relations: s.relations.filter(
          (r) => r.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
        )
      }))
      .filter((s) => s.relations.length > 0);
  }, [schemas, search]);

  const totalFilteredRelations = filteredSchemas.reduce((acc, s) => acc + s.relations.length, 0);

  return (
    <div className="schema-tree" aria-label="Cây cấu trúc database">
      <div className="schema-tree-search">
        <input
          type="search"
          placeholder="Lọc bảng..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="schema-search-input"
          aria-label="Lọc bảng hoặc view"
        />
      </div>

      <div className="schema-tree-content">
        {loading ? (
          <div className="schema-tree-loading">Đang tải cấu trúc…</div>
        ) : totalFilteredRelations === 0 ? (
          <div className="schema-tree-empty">
            {search
              ? 'Không tìm thấy bảng hoặc view phù hợp'
              : 'Không có bảng nào trong cơ sở dữ liệu'}
          </div>
        ) : (
          filteredSchemas.map((schema) => (
            <div key={schema.name} className="schema-group">
              <div className="schema-group-header">
                <span className="schema-group-name">{schema.name}</span>
                <span className="schema-group-badge">{schema.relations.length}</span>
              </div>
              <ul className="schema-relation-list">
                {schema.relations.map((relation) => {
                  const isSelected =
                    selectedSchema === schema.name && selectedRelation === relation.name;

                  return (
                    <li key={relation.name}>
                      <button
                        type="button"
                        className={`relation-item-button ${isSelected ? 'active' : ''}`}
                        onClick={() => onSelectRelation(schema.name, relation.name)}
                        aria-current={isSelected ? 'true' : undefined}
                      >
                        <span className="relation-item-name">{relation.name}</span>
                        <div className="relation-item-meta">
                          {relation.kind !== 'table' && (
                            <span className="relation-kind-tag">{relation.kind}</span>
                          )}
                          {relation.estimatedRows != null && (
                            <span className="relation-rows-tag">~{relation.estimatedRows}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
