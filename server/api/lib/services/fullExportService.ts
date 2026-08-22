import type { DocumentStore, QueryDocumentSnapshot } from '@/server/db/documentStore.js';
import { FULL_EXPORT_COLLECTIONS } from './fullExportCollections.js';

const FULL_EXPORT_PAGE_SIZE = 500;

type ExportWriter = (chunk: string) => void | Promise<void>;

export interface FullExportStreamResult {
  bytes: number;
  rows: number;
  exportedCollections: number;
}

function escapeSqlId(id: string): string {
  return id.replace(/`/g, '``');
}

function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return (
    "'" +
    str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''")
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      // eslint-disable-next-line no-control-regex -- \x1a (Ctrl-Z) is a valid SQL escape sequence
      .replace(/\x1a/g, '\\Z') +
    "'"
  );
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return char;
    }
  });
}

function sanitizeWorksheetName(name: string): string {
  return (
    name
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet'
  );
}

function normalizeExportValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function exportRow(doc: QueryDocumentSnapshot): Record<string, unknown> {
  return { id: doc.id, ...doc.data() };
}

async function forEachCollectionPage(
  db: DocumentStore,
  collectionName: string,
  visitor: (docs: QueryDocumentSnapshot[]) => void | Promise<void>
): Promise<number> {
  let cursor: QueryDocumentSnapshot | null = null;
  let rows = 0;

  while (true) {
    let query = db.collection(collectionName).orderBy('__name__').limit(FULL_EXPORT_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.docs.length > 0) {
      await visitor(snap.docs);
      rows += snap.docs.length;
    }
    if (snap.size < FULL_EXPORT_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] || null;
    if (!cursor) break;
  }

  return rows;
}

function trackedWriter(writer: ExportWriter) {
  let bytes = 0;
  return {
    async write(chunk: string): Promise<void> {
      bytes += Buffer.byteLength(chunk, 'utf8');
      await writer(chunk);
    },
    bytes(): number {
      return bytes;
    },
  };
}

async function getCollectionColumns(
  db: DocumentStore,
  collectionName: string
): Promise<{ columns: string[]; rowCount: number }> {
  const columnsSet = new Set<string>();
  let rowCount = 0;
  await forEachCollectionPage(db, collectionName, (docs) => {
    rowCount += docs.length;
    docs.forEach((doc) => {
      Object.keys(exportRow(doc)).forEach((key) => columnsSet.add(key));
    });
  });
  return { columns: Array.from(columnsSet), rowCount };
}

export async function streamSqlExport(
  db: DocumentStore,
  writer: ExportWriter
): Promise<FullExportStreamResult> {
  const output = trackedWriter(writer);
  let rows = 0;
  let exportedCollections = 0;

  await output.write(`-- EduTrack Data Export - ${new Date().toLocaleString()}\n`);
  await output.write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n');

  for (const collectionName of FULL_EXPORT_COLLECTIONS) {
    const { columns, rowCount } = await getCollectionColumns(db, collectionName);
    if (rowCount === 0) continue;

    await output.write(`-- Table: ${collectionName}\n`);
    await output.write(`DROP TABLE IF EXISTS \`${collectionName}\`;\n`);
    await output.write(`CREATE TABLE \`${collectionName}\` (\n`);
    await output.write(
      columns
        .map(
          (column, index) =>
            `  \`${escapeSqlId(column)}\` TEXT${index === columns.length - 1 ? '' : ','}\n`
        )
        .join('')
    );
    await output.write(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n');
    await output.write(
      `INSERT INTO \`${collectionName}\` (\`${columns.map(escapeSqlId).join('`, `')}\`) VALUES\n`
    );

    let startedRows = false;
    const collectionRows = await forEachCollectionPage(db, collectionName, async (docs) => {
      const pageRows = docs.map(exportRow);
      const pageContent = pageRows
        .map((row) => {
          const values = columns.map((column) => escapeSqlValue(row[column]));
          return `(${values.join(', ')})`;
        })
        .join(',\n');
      await output.write(`${startedRows ? ',\n' : ''}${pageContent}`);
      startedRows = true;
    });

    await output.write(';\n\n');
    rows += collectionRows;
    exportedCollections += 1;
  }

  await output.write('SET FOREIGN_KEY_CHECKS = 1;\n');
  return { bytes: output.bytes(), rows, exportedCollections };
}

function xmlWorkbookHeader(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="10"/>
    </Style>
  </Styles>
  `;
}

export async function streamExcelExport(
  db: DocumentStore,
  writer: ExportWriter
): Promise<FullExportStreamResult> {
  const output = trackedWriter(writer);
  let rows = 0;
  let exportedCollections = 0;

  await output.write(xmlWorkbookHeader());

  for (const collectionName of FULL_EXPORT_COLLECTIONS) {
    const { columns, rowCount } = await getCollectionColumns(db, collectionName);
    if (rowCount === 0) continue;

    const headerRow = `<Row>${columns
      .map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`)
      .join('')}</Row>`;
    await output.write(
      `<Worksheet ss:Name="${escapeXml(sanitizeWorksheetName(collectionName))}"><Table>${headerRow}`
    );
    await forEachCollectionPage(db, collectionName, async (docs) => {
      const dataRows = docs
        .map((doc) => {
          const row = exportRow(doc);
          return `<Row>${columns
            .map(
              (header) =>
                `<Cell><Data ss:Type="String">${escapeXml(normalizeExportValue(row[header]))}</Data></Cell>`
            )
            .join('')}</Row>`;
        })
        .join('');
      await output.write(dataRows);
    });
    await output.write('</Table></Worksheet>');
    rows += rowCount;
    exportedCollections += 1;
  }

  if (exportedCollections === 0) {
    await output.write(
      '<Worksheet ss:Name="No data"><Table><Row><Cell><Data ss:Type="String">No data</Data></Cell></Row></Table></Worksheet>'
    );
  }
  await output.write('\n</Workbook>');
  return { bytes: output.bytes(), rows, exportedCollections };
}
