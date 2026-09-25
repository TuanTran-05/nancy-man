import { describe, expect, it } from 'vitest';
import { renderDatabaseExplorerGrants } from './render-database-explorer-grants.js';
import type { DatabaseExplorerSchemaSnapshot } from '../../packages/contracts/src/databaseExplorer.js';

describe('renderDatabaseExplorerGrants', () => {
  const snapshot: DatabaseExplorerSchemaSnapshot = {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum: 'a'.repeat(64),
    policyVersion: '2026-09-25',
    edges: [],
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'students',
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: true,
            estimatedRows: 100,
            primaryKey: ['id'],
            paginationKey: ['id'],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            columns: [
              {
                name: 'id',
                dataType: 'uuid',
                nullable: false,
                hasDefault: true,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq']
              },
              {
                name: 'email',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'pii',
                selectable: true,
                filterOperators: ['eq']
              },
              {
                name: 'password_hash',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'blocked',
                selectable: false,
                filterOperators: []
              }
            ]
          },
          {
            name: 'foreign_archive',
            kind: 'foreign_table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: false,
            estimatedRows: null,
            primaryKey: null,
            paginationKey: null,
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            columns: [
              {
                name: 'payload',
                dataType: 'text',
                nullable: true,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq']
              }
            ]
          }
        ]
      }
    ]
  };

  it('renders column-level SELECT grants only for safe columns and excludes blocked columns', () => {
    const sql = renderDatabaseExplorerGrants({ snapshot });

    expect(sql).toContain('GRANT USAGE ON SCHEMA "public" TO "ops_database_browser";');
    expect(sql).toContain(
      'GRANT SELECT ("id", "email") ON "public"."students" TO "ops_database_browser";'
    );
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('foreign_archive');
  });

  it('never emits INSERT, UPDATE, DELETE, or table-level SELECT on all columns', () => {
    const sql = renderDatabaseExplorerGrants({ snapshot });

    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER/i);
    expect(sql).not.toMatch(/GRANT SELECT ON "public"\."students"/i);
  });

  it('safely escapes identifiers with embedded double quotes', () => {
    const oddSnapshot: DatabaseExplorerSchemaSnapshot = {
      targetId: 'ops',
      targetLabel: 'Ops',
      checksum: 'b'.repeat(64),
      policyVersion: '2026-09-25',
      edges: [],
      schemas: [
        {
          name: 'Odd"Schema',
          relations: [
            {
              name: 'weird"table',
              kind: 'table',
              rowLevelSecurity: { enabled: false, forced: false },
              dataAvailable: true,
              estimatedRows: 1,
              primaryKey: null,
              paginationKey: null,
              constraints: [],
              indexes: [],
              triggers: [],
              policies: [],
              columns: [
                {
                  name: 'odd"col',
                  dataType: 'text',
                  nullable: true,
                  hasDefault: false,
                  identity: null,
                  generated: false,
                  classification: 'internal',
                  selectable: true,
                  filterOperators: ['eq']
                }
              ]
            }
          ]
        }
      ]
    };

    const sql = renderDatabaseExplorerGrants({ snapshot: oddSnapshot });
    expect(sql).toContain('GRANT USAGE ON SCHEMA "Odd""Schema" TO "ops_database_browser";');
    expect(sql).toContain(
      'GRANT SELECT ("odd""col") ON "Odd""Schema"."weird""table" TO "ops_database_browser";'
    );
  });
});
