import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { materializeDocumentDateOnly } from './lib/materializeDocumentDate.mjs';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const apply = process.argv.includes('--apply');
if (apply && process.env.CONFIRM_DOCUMENT_DATE_REPAIR !== 'repair') {
  throw new Error('Set CONFIRM_DOCUMENT_DATE_REPAIR=repair when using --apply');
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const backupDir = argumentValue('--backup-dir', path.resolve('var/backups'));
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function sessionDateFromId(id) {
  return id.match(/_(\d{4}-\d{2}-\d{2})$/)?.[1] || '';
}

function changedDateFields(before, after) {
  return before.startDate !== after.startDate || before.endDate !== after.endDate;
}

function repairEmbeddedTerms(terms, termById) {
  if (!Array.isArray(terms)) return terms;
  return terms.map((term) => {
    if (!term || typeof term !== 'object') return term;
    const source = termById.get(String(term.id || ''));
    if (!source) return term;
    return { ...term, startDate: source.startDate, endDate: source.endDate };
  });
}

async function buildPlan(client) {
  const documentsResult = await client.query(`
    select collection_path, document_id, data, updated_at
    from app_documents
    where collection_path in ('classes', 'class_sessions')
    order by collection_path, document_id
  `);
  const termsResult = await client.query(`
    select id, class_id, term_start::text as start_date, coalesce(term_end::text, '') as end_date
    from class_terms
    order by class_id, term_start, id
  `);
  const sessionsResult = await client.query(
    `select id, session_date::text as session_date from class_sessions`
  );

  const termsByClass = new Map();
  const termById = new Map();
  for (const row of termsResult.rows) {
    const term = { id: row.id, startDate: row.start_date, endDate: row.end_date };
    const list = termsByClass.get(row.class_id) || [];
    list.push(term);
    termsByClass.set(row.class_id, list);
    termById.set(row.id, term);
  }
  const sessionDateById = new Map(
    sessionsResult.rows.map((row) => [row.id, row.session_date])
  );

  const repairs = [];
  const unresolved = [];
  for (const document of documentsResult.rows) {
    const before = document.data || {};
    let after = before;

    if (document.collection_path === 'classes') {
      const terms = termsByClass.get(document.document_id) || [];
      const current = terms.at(-1);
      if (!current) {
        unresolved.push(`${document.collection_path}/${document.document_id}`);
        continue;
      }
      after = {
        ...before,
        startDate: current.startDate,
        endDate: current.endDate,
        terms: repairEmbeddedTerms(before.terms, termById),
      };
    } else {
      const date =
        sessionDateById.get(document.document_id) ||
        sessionDateFromId(document.document_id) ||
        materializeDocumentDateOnly(before.date);
      if (!isDateOnly(date)) {
        unresolved.push(`${document.collection_path}/${document.document_id}`);
        continue;
      }
      after = { ...before, date };
    }

    const changed =
      document.collection_path === 'classes'
        ? changedDateFields(before, after) || JSON.stringify(before.terms) !== JSON.stringify(after.terms)
        : before.date !== after.date;
    if (changed) repairs.push({ ...document, before, after });
  }

  return { repairs, unresolved };
}

async function verify(client) {
  const result = await client.query(`
    select
      count(*) filter (
        where collection_path = 'classes'
          and ((data->>'startDate') !~ '^\\d{4}-\\d{2}-\\d{2}$'
            or (data->>'endDate') !~ '^\\d{4}-\\d{2}-\\d{2}$')
      )::int as invalid_classes,
      count(*) filter (
        where collection_path = 'class_sessions'
          and (data->>'date') !~ '^\\d{4}-\\d{2}-\\d{2}$'
      )::int as invalid_sessions
    from app_documents
    where collection_path in ('classes', 'class_sessions')
  `);
  return result.rows[0];
}

const client = await pool.connect();
try {
  const beforeVerification = await verify(client);
  const plan = await buildPlan(client);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    beforeVerification,
    repairCount: plan.repairs.length,
    classes: plan.repairs.filter((row) => row.collection_path === 'classes').length,
    classSessions: plan.repairs.filter((row) => row.collection_path === 'class_sessions').length,
    unresolvedCount: plan.unresolved.length,
    unresolvedPreview: plan.unresolved.slice(0, 20),
    repairPreview: plan.repairs.slice(0, 10).map((row) => ({
      path: `${row.collection_path}/${row.document_id}`,
      before:
        row.collection_path === 'classes'
          ? { startDate: row.before.startDate, endDate: row.before.endDate }
          : { date: row.before.date },
      after:
        row.collection_path === 'classes'
          ? { startDate: row.after.startDate, endDate: row.after.endDate }
          : { date: row.after.date },
    })),
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `document-date-repair-${stamp}.json`);
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
          throw new Error(`Concurrent document change: ${repair.collection_path}/${repair.document_id}`);
        }
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    console.log(
      JSON.stringify(
        { ...summary, backupPath, afterVerification: await verify(client) },
        null,
        2
      )
    );
  }
} finally {
  client.release();
  await pool.end();
}
