import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import pg from 'pg';
import {
  projectClassFinanceData,
  projectCourseClosingRecord,
  projectCourseFeeLedger,
} from './lib/financeCourseClosingProjection.mjs';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const apply = process.argv.includes('--apply');
if (apply && process.env.CONFIRM_FINANCE_CLOSING_PROJECTION_REPAIR !== 'repair') {
  throw new Error('Set CONFIRM_FINANCE_CLOSING_PROJECTION_REPAIR=repair when using --apply');
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const backupDir = argumentValue('--backup-dir', path.resolve('var/backups'));
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const COLLECTIONS = ['classes', 'course_fee_ledgers', 'course_closing_records'];

function equal(left, right) {
  return isDeepStrictEqual(left, right);
}

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const list = result.get(row[key]) || [];
    list.push(row);
    result.set(row[key], list);
  }
  return result;
}

async function loadSources(client) {
  const terms = await client.query('select * from class_terms order by class_id, term_start, id');
  const ledgers = await client.query(`
      select ledger.*, totals.paid_total, totals.discount_total,
             totals.sibling_discount_total
        from course_fee_ledgers ledger
        join v_ledger_totals totals on totals.ledger_id = ledger.id
       order by ledger.id
    `);
  const closingRecords = await client.query('select * from course_closing_records order by id');
  const closingDocuments = await client.query(
    'select * from course_closing_record_documents order by record_id, kind'
  );
  return {
    termsByClass: groupBy(terms.rows, 'class_id'),
    ledgers: new Map(ledgers.rows.map((row) => [row.id, row])),
    closingRecords: new Map(closingRecords.rows.map((row) => [row.id, row])),
    closingDocumentsByRecord: groupBy(closingDocuments.rows, 'record_id'),
  };
}

function project(document, sources) {
  const before = document.data || {};
  if (document.collection_path === 'classes') {
    return projectClassFinanceData(before, sources.termsByClass.get(document.document_id) || []);
  }
  if (document.collection_path === 'course_fee_ledgers') {
    const source = sources.ledgers.get(document.document_id);
    return source ? projectCourseFeeLedger(before, source, source) : null;
  }
  if (document.collection_path === 'course_closing_records') {
    const source = sources.closingRecords.get(document.document_id);
    return source
      ? projectCourseClosingRecord(
          source,
          sources.closingDocumentsByRecord.get(document.document_id) || []
        )
      : null;
  }
  return null;
}

function hasNormalizedSource(document, sources) {
  if (document.collection_path === 'classes') {
    return sources.termsByClass.has(document.document_id);
  }
  if (document.collection_path === 'course_fee_ledgers') {
    return sources.ledgers.has(document.document_id);
  }
  if (document.collection_path === 'course_closing_records') {
    return sources.closingRecords.has(document.document_id);
  }
  return false;
}

function validProjection(collection, data) {
  if (collection === 'classes') {
    return (
      (data.tuitionFee === null || Number.isFinite(data.tuitionFee)) &&
      (Array.isArray(data.terms) ? data.terms : []).every(
        (term) => term?.tuitionFee === null || Number.isFinite(term?.tuitionFee)
      )
    );
  }
  if (collection === 'course_fee_ledgers') {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(String(data.termStart || '')) &&
      Number.isFinite(data.amount) &&
      Number.isFinite(data.paidTotal) &&
      Number.isFinite(data.discountTotal)
    );
  }
  if (collection === 'course_closing_records') {
    return Boolean(
      data.id &&
      data.className &&
      data.studentName &&
      data.evaluationDocument?.status &&
      data.tuitionDocument?.status
    );
  }
  return false;
}

async function buildPlan(client) {
  const [documents, sources] = await Promise.all([
    client.query(
      `select collection_path, document_id, data, updated_at
         from app_documents
        where collection_path = any($1::text[])
        order by collection_path, document_id`,
      [COLLECTIONS]
    ),
    loadSources(client),
  ]);
  const repairs = [];
  const unresolved = [];
  let skippedWithoutNormalizedSource = 0;
  for (const document of documents.rows) {
    if (!hasNormalizedSource(document, sources)) {
      skippedWithoutNormalizedSource += 1;
      continue;
    }
    const after = project(document, sources);
    if (!after || !validProjection(document.collection_path, after)) {
      unresolved.push(`${document.collection_path}/${document.document_id}`);
      continue;
    }
    if (!equal(document.data, after)) repairs.push({ ...document, before: document.data, after });
  }
  return { repairs, unresolved, skippedWithoutNormalizedSource };
}

async function verify(client) {
  const result = await client.query(
    `
    select
      count(*) filter (
        where collection_path = 'classes'
          and (
            coalesce(jsonb_typeof(data->'tuitionFee'), '') <> 'number'
            or exists (
              select 1
                from jsonb_array_elements(coalesce(data->'terms', '[]'::jsonb)) term
               where term->'tuitionFee' is not null
                 and jsonb_typeof(term->'tuitionFee') <> 'null'
                 and coalesce(jsonb_typeof(term->'tuitionFee'), '') <> 'number'
            )
          )
      )::int as invalid_class_tuition,
      count(*) filter (
        where collection_path = 'course_fee_ledgers'
          and (
            coalesce(data->>'termStart', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
            or coalesce(jsonb_typeof(data->'amount'), '') <> 'number'
            or coalesce(jsonb_typeof(data->'paidTotal'), '') <> 'number'
            or coalesce(jsonb_typeof(data->'discountTotal'), '') <> 'number'
          )
      )::int as invalid_ledgers,
      count(*) filter (
        where collection_path = 'course_closing_records'
          and (
            coalesce(data->>'className', '') = ''
            or coalesce(data->>'studentName', '') = ''
            or coalesce(data#>>'{evaluationDocument,status}', '') = ''
            or coalesce(data#>>'{tuitionDocument,status}', '') = ''
          )
      )::int as invalid_course_closing_records
    from app_documents
    where collection_path = any($1::text[])
  `,
    [COLLECTIONS]
  );
  return result.rows[0];
}

function repairsByCollection(repairs) {
  return Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection,
      repairs.filter((row) => row.collection_path === collection).length,
    ])
  );
}

const client = await pool.connect();
try {
  const beforeVerification = await verify(client);
  const plan = await buildPlan(client);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    beforeVerification,
    repairCount: plan.repairs.length,
    repairsByCollection: repairsByCollection(plan.repairs),
    unresolvedCount: plan.unresolved.length,
    skippedWithoutNormalizedSource: plan.skippedWithoutNormalizedSource,
    unresolvedPreview: plan.unresolved.slice(0, 20),
    repairPreview: plan.repairs.slice(0, 12).map((row) => ({
      path: `${row.collection_path}/${row.document_id}`,
      before: {
        tuitionFee: row.before.tuitionFee,
        termStart: row.before.termStart,
        amount: row.before.amount,
        className: row.before.className,
        evaluationDocumentStatus: row.before.evaluationDocument?.status,
      },
      after: {
        tuitionFee: row.after.tuitionFee,
        termStart: row.after.termStart,
        amount: row.after.amount,
        paidTotal: row.after.paidTotal,
        className: row.after.className,
        evaluationDocumentStatus: row.after.evaluationDocument?.status,
      },
    })),
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (plan.unresolved.length > 0) {
      throw new Error(`Repair has ${plan.unresolved.length} unresolved documents; refusing apply`);
    }
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `finance-course-closing-projection-repair-${stamp}.json`
    );
    await writeFile(
      backupPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          repairs: plan.repairs.map((row) => ({
            collectionPath: row.collection_path,
            documentId: row.document_id,
            updatedAt: row.updated_at,
            data: row.before,
          })),
        },
        null,
        2
      ),
      'utf8'
    );

    await client.query('begin');
    try {
      for (const repair of plan.repairs) {
        const result = await client.query(
          `update app_documents
              set data = $3::jsonb, updated_at = now()
            where collection_path = $1 and document_id = $2 and data = $4::jsonb`,
          [
            repair.collection_path,
            repair.document_id,
            JSON.stringify(repair.after),
            JSON.stringify(repair.before),
          ]
        );
        if (result.rowCount !== 1) {
          throw new Error(
            `Concurrent document change: ${repair.collection_path}/${repair.document_id}`
          );
        }
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    console.log(
      JSON.stringify({ ...summary, backupPath, afterVerification: await verify(client) }, null, 2)
    );
  }
} finally {
  client.release();
  await pool.end();
}
