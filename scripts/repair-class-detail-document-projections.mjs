import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { materializeDocumentDateOnly } from './lib/materializeDocumentDate.mjs';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const apply = process.argv.includes('--apply');
if (apply && process.env.CONFIRM_CLASS_DETAIL_PROJECTION_REPAIR !== 'repair') {
  throw new Error(
    'Set CONFIRM_CLASS_DETAIL_PROJECTION_REPAIR=repair when using --apply'
  );
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const backupDir = argumentValue('--backup-dir', path.resolve('var/backups'));
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const COLLECTIONS = [
  'classes',
  'student_course_enrollments',
  'attendance',
  'class_sessions',
  'evaluations',
  'dailyReports',
];

function isDateOnly(value) {
  return DATE_ONLY.test(String(value || ''));
}

function dateFromDocumentId(id) {
  return id.match(/_(\d{4}-\d{2}-\d{2})$/)?.[1] || '';
}

function isScoresObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ['attendance', 'behavior', 'effort', 'homework', 'pronunciation'].every(
        (key) => Number.isFinite(Number(value[key]))
      )
  );
}

function documentsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requiresRepair(collection, data) {
  if (collection === 'classes') {
    if (!isDateOnly(data.startDate) || (data.endDate && !isDateOnly(data.endDate))) return true;
    return (Array.isArray(data.terms) ? data.terms : []).some(
      (term) =>
        term &&
        typeof term === 'object' &&
        (!isDateOnly(term.startDate) ||
          (term.endDate && !isDateOnly(term.endDate)) ||
          !isDateOnly(term.termStart) ||
          (term.termEnd && !isDateOnly(term.termEnd)))
    );
  }
  if (collection === 'student_course_enrollments') {
    return (
      !isDateOnly(data.termStart) ||
      (data.termEnd && !isDateOnly(data.termEnd)) ||
      !isDateOnly(data.joinedAt) ||
      (data.endedAt && !isDateOnly(data.endedAt))
    );
  }
  if (collection === 'attendance' || collection === 'class_sessions') {
    return !isDateOnly(data.date);
  }
  if (collection === 'evaluations') {
    return !isDateOnly(data.date) || !isScoresObject(data.scores);
  }
  if (collection === 'dailyReports') return !isDateOnly(data.date);
  return false;
}

async function loadSources(client) {
  const terms = await client.query(`
        select id, class_id, term_start::text as term_start,
               coalesce(term_end::text, '') as term_end
          from class_terms
         order by class_id, term_start, id
      `);
  const holidays = await client.query(`
        select term_id, holiday_date::text as holiday_date
          from class_holidays
         order by term_id, holiday_date
      `);
  const enrollments = await client.query(`
        select id, term_start::text as term_start, coalesce(term_end::text, '') as term_end,
               joined_at::text as joined_at, coalesce(ended_at::text, '') as ended_at
          from student_course_enrollments
      `);
  const attendance = await client.query(
    `select id, attendance_date::text as date from attendance`
  );
  const sessions = await client.query(`select id, session_date::text as date from class_sessions`);
  const evaluations = await client.query(`
        select id,
               to_char(evaluated_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as date,
               coalesce(term_start::text, '') as term_start,
               coalesce(term_end::text, '') as term_end,
               score_attendance, score_behavior, score_effort, score_homework,
               score_pronunciation
          from evaluations
      `);
  const reports = await client.query(`select id, report_date::text as date from daily_reports`);

  const holidaysByTerm = new Map();
  for (const row of holidays.rows) {
    const list = holidaysByTerm.get(row.term_id) || [];
    list.push(row.holiday_date);
    holidaysByTerm.set(row.term_id, list);
  }

  const termsByClass = new Map();
  const termById = new Map();
  for (const row of terms.rows) {
    const source = {
      id: row.id,
      startDate: row.term_start,
      endDate: row.term_end,
      holidays: holidaysByTerm.get(row.id) || [],
    };
    const list = termsByClass.get(row.class_id) || [];
    list.push(source);
    termsByClass.set(row.class_id, list);
    termById.set(row.id, source);
  }

  return {
    termsByClass,
    termById,
    enrollments: new Map(enrollments.rows.map((row) => [row.id, row])),
    attendance: new Map(attendance.rows.map((row) => [row.id, row])),
    sessions: new Map(sessions.rows.map((row) => [row.id, row])),
    evaluations: new Map(evaluations.rows.map((row) => [row.id, row])),
    reports: new Map(reports.rows.map((row) => [row.id, row])),
  };
}

function repairClass(id, before, sources) {
  const terms = sources.termsByClass.get(id) || [];
  const current = terms.at(-1);
  if (!current) return null;
  const embeddedTerms = Array.isArray(before.terms)
    ? before.terms.map((term) => {
        if (!term || typeof term !== 'object') return term;
        const source = sources.termById.get(String(term.id || ''));
        if (!source) return term;
        return {
          ...term,
          startDate: source.startDate,
          endDate: source.endDate,
          termStart: source.startDate,
          termEnd: source.endDate || null,
          holidays: source.holidays,
        };
      })
    : before.terms;
  return {
    ...before,
    startDate: current.startDate,
    endDate: current.endDate,
    holidays: current.holidays,
    terms: embeddedTerms,
  };
}

function repairEnrollment(id, before, sources) {
  const source = sources.enrollments.get(id);
  const termStart = source?.term_start || materializeDocumentDateOnly(before.termStart);
  const termEnd = source?.term_end || materializeDocumentDateOnly(before.termEnd);
  const joinedAt = source?.joined_at || materializeDocumentDateOnly(before.joinedAt);
  const endedAt = source?.ended_at || materializeDocumentDateOnly(before.endedAt);
  if (!isDateOnly(termStart) || !isDateOnly(joinedAt)) return null;
  return {
    ...before,
    termStart,
    termEnd: termEnd || null,
    joinedAt,
    endedAt: endedAt || null,
  };
}

function repairDatedDocument(id, before, source) {
  const date =
    source?.date ||
    dateFromDocumentId(id) ||
    materializeDocumentDateOnly(before.date || before.attendanceDate || before.sessionDate);
  return isDateOnly(date) ? { ...before, date } : null;
}

function repairEvaluation(id, before, sources) {
  const source = sources.evaluations.get(id);
  const date = source?.date || materializeDocumentDateOnly(before.date || before.evaluatedAt);
  if (!isDateOnly(date)) return null;
  const scores = source
    ? {
        attendance: Number(source.score_attendance || 0),
        behavior: Number(source.score_behavior || 0),
        effort: Number(source.score_effort || 0),
        homework: Number(source.score_homework || 0),
        pronunciation: Number(source.score_pronunciation || 0),
      }
    : before.scores;
  if (!isScoresObject(scores)) return null;
  return {
    ...before,
    date,
    scores,
    ...(source?.term_start ? { termStart: source.term_start } : {}),
    ...(source?.term_end ? { termEnd: source.term_end } : {}),
  };
}

function repairDocument(document, sources) {
  const before = document.data || {};
  if (document.collection_path === 'classes') {
    return repairClass(document.document_id, before, sources);
  }
  if (document.collection_path === 'student_course_enrollments') {
    return repairEnrollment(document.document_id, before, sources);
  }
  if (document.collection_path === 'attendance') {
    return repairDatedDocument(
      document.document_id,
      before,
      sources.attendance.get(document.document_id)
    );
  }
  if (document.collection_path === 'class_sessions') {
    return repairDatedDocument(
      document.document_id,
      before,
      sources.sessions.get(document.document_id)
    );
  }
  if (document.collection_path === 'evaluations') {
    return repairEvaluation(document.document_id, before, sources);
  }
  if (document.collection_path === 'dailyReports') {
    return repairDatedDocument(
      document.document_id,
      before,
      sources.reports.get(document.document_id)
    );
  }
  return before;
}

async function buildPlan(client) {
  const [documentsResult, sources] = await Promise.all([
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
  for (const document of documentsResult.rows) {
    const before = document.data || {};
    if (!requiresRepair(document.collection_path, before)) continue;
    const after = repairDocument(document, sources);
    if (!after || requiresRepair(document.collection_path, after)) {
      unresolved.push(`${document.collection_path}/${document.document_id}`);
      continue;
    }
    if (!documentsEqual(before, after)) repairs.push({ ...document, before, after });
  }
  return { repairs, unresolved };
}

async function verify(client) {
  const result = await client.query(`
    select
      count(*) filter (where collection_path = 'classes'
        and (coalesce(data->>'startDate', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
          or (coalesce(data->>'endDate', '') <> '' and coalesce(data->>'endDate', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')
          or exists (
            select 1
              from jsonb_array_elements(coalesce(data->'terms', '[]'::jsonb)) as term
             where coalesce(term->>'startDate', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
                or coalesce(term->>'termStart', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
                or (coalesce(term->>'endDate', '') <> '' and coalesce(term->>'endDate', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')
                or (coalesce(term->>'termEnd', '') <> '' and coalesce(term->>'termEnd', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')
          )))::int as invalid_classes,
      count(*) filter (where collection_path = 'student_course_enrollments'
        and (coalesce(data->>'termStart', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
          or coalesce(data->>'joinedAt', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'))::int as invalid_enrollments,
      count(*) filter (where collection_path = 'attendance'
        and coalesce(data->>'date', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')::int as invalid_attendance,
      count(*) filter (where collection_path = 'class_sessions'
        and coalesce(data->>'date', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')::int as invalid_sessions,
      count(*) filter (where collection_path = 'evaluations'
        and (coalesce(data->>'date', '') !~ '^\\d{4}-\\d{2}-\\d{2}$'
          or coalesce(jsonb_typeof(data->'scores'), '') <> 'object'))::int as invalid_evaluations,
      count(*) filter (where collection_path = 'dailyReports'
        and coalesce(data->>'date', '') !~ '^\\d{4}-\\d{2}-\\d{2}$')::int as invalid_reports
    from app_documents
    where collection_path = any($1::text[])
  `, [COLLECTIONS]);
  return result.rows[0];
}

function summarizeRepairs(repairs) {
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
    repairsByCollection: summarizeRepairs(plan.repairs),
    unresolvedCount: plan.unresolved.length,
    unresolvedPreview: plan.unresolved.slice(0, 20),
    repairPreview: plan.repairs.slice(0, 12).map((row) => ({
      path: `${row.collection_path}/${row.document_id}`,
      before: {
        startDate: row.before.startDate,
        endDate: row.before.endDate,
        termStart: row.before.termStart,
        joinedAt: row.before.joinedAt,
        date: row.before.date,
        hasScores: isScoresObject(row.before.scores),
      },
      after: {
        startDate: row.after.startDate,
        endDate: row.after.endDate,
        termStart: row.after.termStart,
        joinedAt: row.after.joinedAt,
        date: row.after.date,
        hasScores: isScoresObject(row.after.scores),
      },
    })),
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `class-detail-projection-repair-${stamp}.json`);
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
