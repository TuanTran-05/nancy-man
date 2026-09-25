import type { DatabaseExplorerSchemaSnapshot } from '../../packages/contracts/src/databaseExplorer.js';
import { quoteIdentifier } from '../../apps/sql-worker/src/explorer/identifier.js';

export type RenderGrantsInput = {
  snapshot: DatabaseExplorerSchemaSnapshot;
  roleName?: string;
};

export function renderDatabaseExplorerGrants(input: RenderGrantsInput): string {
  const roleName = input.roleName ?? 'ops_database_browser';
  const roleQuoted = quoteIdentifier(roleName);
  const statements: string[] = [];

  statements.push(`-- Database Explorer grants for role ${roleQuoted}`);
  statements.push(`-- Target: ${input.snapshot.targetId} (Checksum: ${input.snapshot.checksum})`);
  statements.push('BEGIN;');

  for (const schema of input.snapshot.schemas) {
    const schemaQuoted = quoteIdentifier(schema.name);
    statements.push(`GRANT USAGE ON SCHEMA ${schemaQuoted} TO ${roleQuoted};`);

    for (const relation of schema.relations) {
      if (!relation.dataAvailable || relation.kind === 'foreign_table') {
        continue;
      }

      const safeColumns = relation.columns.filter(
        (col) => col.selectable && col.classification !== 'blocked'
      );

      if (safeColumns.length === 0) {
        continue;
      }

      const relationQuoted = quoteIdentifier(relation.name);
      const columnsQuoted = safeColumns.map((c) => quoteIdentifier(c.name)).join(', ');

      statements.push(
        `GRANT SELECT (${columnsQuoted}) ON ${schemaQuoted}.${relationQuoted} TO ${roleQuoted};`
      );
    }
  }

  statements.push('COMMIT;');
  statements.push('');

  return statements.join('\n');
}
