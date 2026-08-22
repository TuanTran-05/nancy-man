import pg from 'pg';
import { materializeDocumentDateOnly } from './lib/materializeDocumentDate.mjs';
import {
  projectClassFinanceData,
  projectCourseClosingRecord,
  projectCourseFeeLedger,
} from './lib/financeCourseClosingProjection.mjs';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const replace = process.argv.includes('--replace');
if (replace && process.env.CONFIRM_DOCUMENT_STORE_REPLACE !== 'replace') {
  throw new Error('Set CONFIRM_DOCUMENT_STORE_REPLACE=replace when using --replace');
}

const EXCLUDED_TABLES = new Set([
  'app_documents',
  'auth_otp_challenges',
  'auth_rate_limits',
  'auth_sessions',
  'auth_user_providers',
  'schema_migrations',
  'staff_password_credentials',
]);

const COLLECTION_BY_TABLE = new Map([
  ['daily_reports', 'dailyReports'],
  ['knowledge_bank_items', 'knowledge_bank'],
  ['maintenance_flags', '_maintenance'],
  ['password_reset_requests', 'passwordResetRequests'],
  ['staff_password_reset_requests', 'staffPasswordResetRequests'],
  ['zalo_config', '_zalo_config'],
]);

function camelCase(value) {
  return value.replace(/_([a-z0-9])/g, (_match, character) => character.toUpperCase());
}

function camelObject(value) {
  if (Array.isArray(value)) return value.map(camelObject);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [camelCase(key), camelObject(entry)])
  );
}

function documentId(table, row, primaryKey) {
  if (row.id != null) return String(row.id);
  if (table === 'staff_email_access') return String(row.email);
  if (table === 'student_auth_credentials' || table === 'student_wallets') {
    return String(row.student_id);
  }
  if (row.key != null) return String(row.key);
  const values = primaryKey.map((column) => row[column]).filter((value) => value != null);
  return values.length ? values.map(String).join('__') : null;
}

function normalizeDocument(table, row) {
  const document = camelObject(row);
  if (table === 'classes') {
    document.salaryPerSession = Number(row.salary_per_session || 0);
    document.tuitionFee = Number(row.tuition_fee || 0);
  }
  if (table === 'class_terms') {
    document.tuitionFee = Number(row.tuition_fee || 0);
  }
  if (table === 'users') {
    document.uid = row.id;
    document.blockedTeacher = Boolean(row.is_revoked);
  }
  if (table === 'students') document.studentId = row.code;
  if (table === 'student_course_enrollments') {
    document.termStart = materializeDocumentDateOnly(row.term_start);
    document.termEnd = materializeDocumentDateOnly(row.term_end) || null;
    document.joinedAt = materializeDocumentDateOnly(row.joined_at);
    document.endedAt = materializeDocumentDateOnly(row.ended_at) || null;
  }
  if (table === 'course_fee_ledgers') {
    document.termStart = materializeDocumentDateOnly(row.term_start);
    document.termEnd = materializeDocumentDateOnly(row.term_end) || null;
    document.dueDate = materializeDocumentDateOnly(row.due_date) || null;
    document.amount = Number(row.amount);
  }
  if (table === 'class_sessions') document.date = materializeDocumentDateOnly(row.session_date);
  if (table === 'attendance' && row.attendance_date) {
    document.date = materializeDocumentDateOnly(row.attendance_date);
  }
  if (table === 'evaluations') {
    document.date = materializeDocumentDateOnly(row.evaluated_at);
    document.termStart = materializeDocumentDateOnly(row.term_start) || undefined;
    document.termEnd = materializeDocumentDateOnly(row.term_end) || undefined;
    document.scores = {
      attendance: Number(row.score_attendance || 0),
      behavior: Number(row.score_behavior || 0),
      effort: Number(row.score_effort || 0),
      homework: Number(row.score_homework || 0),
      pronunciation: Number(row.score_pronunciation || 0),
    };
  }
  if (table === 'daily_reports') {
    document.date = materializeDocumentDateOnly(row.report_date);
  }
  if (table === 'student_auth_credentials') document.studentId = row.student_id;
  if (table === 'audit_logs') {
    document.timestamp = row.occurred_at;
    document.collection = row.entity_table;
    document.documentId = row.entity_id;
  }
  if (table === 'substitute_requests') {
    document.date = materializeDocumentDateOnly(row.session_date);
  }
  if (table === 'password_reset_requests') {
    document.studentDocId = row.student_id;
    document.type = row.scope;
    document.createdAt = row.requested_at;
  }
  if (table === 'staff_password_reset_requests') {
    document.uid = row.user_id;
    document.requestedBy = row.user_id;
    document.createdAt = row.requested_at;
  }
  return document;
}

async function upsert(client, collectionPath, id, data, createdAt, updatedAt) {
  await client.query(
    `insert into app_documents
       (collection_path, document_id, data, created_at, updated_at)
     values ($1, $2, $3::jsonb, coalesce($4, now()), coalesce($5, now()))
     on conflict (collection_path, document_id) do update
       set data = excluded.data,
           updated_at = excluded.updated_at`,
    [collectionPath, id, JSON.stringify(data), createdAt || null, updatedAt || null]
  );
}

async function enrichClasses(client) {
  const [termsResult, sessionsResult, holidaysResult, classesResult] = await Promise.all([
    client.query('select * from class_terms order by class_id, term_start'),
    client.query(
      'select * from class_term_weekly_sessions order by term_id, day_of_week, start_time'
    ),
    client.query('select * from class_holidays order by term_id, holiday_date'),
    client.query("select document_id, data from app_documents where collection_path = 'classes'"),
  ]);
  const sessionsByTerm = new Map();
  for (const row of sessionsResult.rows) {
    const list = sessionsByTerm.get(row.term_id) || [];
    list.push(camelObject(row));
    sessionsByTerm.set(row.term_id, list);
  }
  const holidaysByTerm = new Map();
  for (const row of holidaysResult.rows) {
    const list = holidaysByTerm.get(row.term_id) || [];
    list.push(materializeDocumentDateOnly(row.holiday_date));
    holidaysByTerm.set(row.term_id, list);
  }
  const termsByClass = new Map();
  for (const row of termsResult.rows) {
    const term = camelObject(row);
    term.startDate = materializeDocumentDateOnly(row.term_start);
    term.endDate = materializeDocumentDateOnly(row.term_end);
    term.termStart = term.startDate;
    term.termEnd = term.endDate || null;
    term.weeklySessions = sessionsByTerm.get(row.id) || [];
    term.holidays = holidaysByTerm.get(row.id) || [];
    const list = termsByClass.get(row.class_id) || [];
    list.push(term);
    termsByClass.set(row.class_id, list);
  }
  for (const row of classesResult.rows) {
    const terms = termsByClass.get(row.document_id) || [];
    const current = terms.at(-1);
    let data = projectClassFinanceData(
      { ...row.data, terms },
      termsResult.rows.filter((term) => term.class_id === row.document_id)
    );
    if (current) {
      Object.assign(data, {
        startDate: current.startDate,
        endDate: current.endDate,
        startTime: current.startTime || '',
        daysOfWeek: current.daysOfWeek || [],
        tuitionFee: data.tuitionFee,
        currentCourseId: current.courseId || null,
        weeklySessions: current.weeklySessions || [],
        holidays: current.holidays || [],
      });
    }
    await client.query(
      `update app_documents set data = $3::jsonb, updated_at = now()
        where collection_path = $1 and document_id = $2`,
      ['classes', row.document_id, JSON.stringify(data)]
    );
  }
}

async function enrichCourseFeeLedgers(client) {
  const result = await client.query(`
    select ledger.*, totals.paid_total, totals.discount_total, totals.sibling_discount_total
      from course_fee_ledgers ledger
      join v_ledger_totals totals on totals.ledger_id = ledger.id
     order by ledger.id
  `);
  for (const row of result.rows) {
    const document = await client.query(
      `select data from app_documents
        where collection_path = 'course_fee_ledgers' and document_id = $1`,
      [row.id]
    );
    if (document.rowCount !== 1) continue;
    const data = projectCourseFeeLedger(document.rows[0].data, row, row);
    await client.query(
      `update app_documents set data = $3::jsonb, updated_at = now()
        where collection_path = $1 and document_id = $2`,
      ['course_fee_ledgers', row.id, JSON.stringify(data)]
    );
  }
}

async function enrichCourseClosingRecords(client) {
  const [recordsResult, documentsResult] = await Promise.all([
    client.query('select * from course_closing_records order by id'),
    client.query('select * from course_closing_record_documents order by record_id, kind'),
  ]);
  const documentsByRecord = new Map();
  for (const row of documentsResult.rows) {
    const list = documentsByRecord.get(row.record_id) || [];
    list.push(row);
    documentsByRecord.set(row.record_id, list);
  }
  for (const row of recordsResult.rows) {
    const data = projectCourseClosingRecord(row, documentsByRecord.get(row.id) || []);
    await upsert(client, 'course_closing_records', row.id, data, row.created_at, row.updated_at);
  }
}

function iso(value) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dateOnly(value) {
  return materializeDocumentDateOnly(value);
}

function extension(filename) {
  return (
    String(filename || '')
      .split('.')
      .pop()
      ?.toLowerCase() || 'pdf'
  );
}

function groupedSelections(rows, ownerKey) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row[ownerKey]) || [];
    list.push({ dayKey: row.day_key, slotId: row.slot_id });
    grouped.set(row[ownerKey], list);
  }
  return grouped;
}

async function enrichFrontendCollections(client) {
  const [usersResult, classesResult] = await Promise.all([
    client.query('select id, display_name, role from users'),
    client.query('select id, name from classes'),
  ]);
  const users = new Map(usersResult.rows.map((row) => [row.id, row]));
  const classes = new Map(classesResult.rows.map((row) => [row.id, row]));

  const knowledge = await client.query('select * from knowledge_bank_items');
  for (const row of knowledge.rows) {
    const data = normalizeDocument('knowledge_bank_items', row);
    data.uploadedByName = users.get(row.uploaded_by)?.display_name || '';
    if (row.class_id) data.className = classes.get(row.class_id)?.name || '';
    if (row.target_type === 'global' && row.program_name) data.targetType = 'program';
    await upsert(client, 'knowledge_bank', row.id, data, row.created_at, row.updated_at);
  }

  const [printRequests, printFiles] = await Promise.all([
    client.query('select * from print_requests'),
    client.query('select * from print_request_files order by print_request_id, position'),
  ]);
  const filesByRequest = new Map();
  for (const file of printFiles.rows) {
    const list = filesByRequest.get(file.print_request_id) || [];
    list.push({
      id: file.id,
      originalFilename: file.original_filename,
      fileType: extension(file.original_filename),
      mimeType: file.mime_type || '',
      fileSize: Number(file.file_size || 0),
      storagePath: file.storage_path,
      quantity: 1,
    });
    filesByRequest.set(file.print_request_id, list);
  }
  for (const row of printRequests.rows) {
    const status = row.status === 'accepted' ? 'pending' : row.status;
    const files = (filesByRequest.get(row.id) || []).map((file) => ({
      ...file,
      quantity: Number(row.copies || 1),
    }));
    const handledAt = iso(row.handled_at);
    const data = {
      id: row.id,
      teacherId: row.teacher_id,
      teacherName: users.get(row.teacher_id)?.display_name || '',
      classId: row.class_id || '',
      className: classes.get(row.class_id)?.name || '',
      neededAt: dateOnly(row.needed_by),
      neededDate: dateOnly(row.needed_by),
      createdDate: dateOnly(row.created_at),
      status,
      ...(row.note ? { note: row.note } : {}),
      files,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.handled_by ? { handledBy: row.handled_by } : {}),
      ...(row.handled_by ? { handledByName: users.get(row.handled_by)?.display_name || '' } : {}),
      ...(status === 'printed' && handledAt ? { printedAt: handledAt } : {}),
      ...(status === 'rejected' && handledAt ? { rejectedAt: handledAt } : {}),
      ...(status === 'cancelled' && handledAt ? { cancelledAt: handledAt } : {}),
    };
    await upsert(client, 'print_requests', row.id, data, row.created_at, row.updated_at);
  }

  const [profiles, profileSelections, requests, requestSelections] = await Promise.all([
    client.query('select * from teacher_availability_profiles'),
    client.query(
      'select * from teacher_availability_profile_selections order by profile_id, day_key, slot_id'
    ),
    client.query('select * from teacher_availability_change_requests'),
    client.query(
      'select * from teacher_availability_change_request_selections order by request_id, day_key, slot_id'
    ),
  ]);
  const profilesSelections = groupedSelections(profileSelections.rows, 'profile_id');
  const requestsSelections = groupedSelections(requestSelections.rows, 'request_id');
  for (const row of profiles.rows) {
    const selections = profilesSelections.get(row.id) || [];
    await upsert(
      client,
      'teacher_availability_profiles',
      row.id,
      {
        ...normalizeDocument('teacher_availability_profiles', row),
        teacherName: users.get(row.teacher_id)?.display_name || '',
        selections,
        selectionKeys: selections.map((entry) => `${entry.dayKey}:${entry.slotId}`),
      },
      row.created_at,
      row.updated_at
    );
  }
  for (const row of requests.rows) {
    const requestedSelections = requestsSelections.get(row.id) || [];
    const currentSelections = profilesSelections.get(row.profile_id) || [];
    await upsert(
      client,
      'teacher_availability_change_requests',
      row.id,
      {
        ...normalizeDocument('teacher_availability_change_requests', row),
        teacherName: users.get(row.teacher_id)?.display_name || '',
        currentSelections,
        requestedSelections,
        requestedSelectionKeys: requestedSelections.map(
          (entry) => `${entry.dayKey}:${entry.slotId}`
        ),
        reviewedByName: row.reviewed_by
          ? users.get(row.reviewed_by)?.display_name || ''
          : undefined,
        createdAt: iso(row.requested_at),
      },
      row.created_at,
      row.updated_at
    );
  }

  const substitutes = await client.query('select * from substitute_requests');
  for (const row of substitutes.rows) {
    await upsert(
      client,
      'substitute_requests',
      row.id,
      {
        ...normalizeDocument('substitute_requests', row),
        requestingTeacherName: users.get(row.requesting_teacher_id)?.display_name || '',
        substituteTeacherName: row.substitute_teacher_id
          ? users.get(row.substitute_teacher_id)?.display_name || ''
          : undefined,
        className: classes.get(row.class_id)?.name || '',
        status: row.status === 'rejected' ? 'cancelled' : row.status,
        acceptedAt: row.status === 'accepted' ? iso(row.responded_at) : undefined,
      },
      row.created_at,
      row.updated_at
    );
  }

  const staffResets = await client.query('select * from staff_password_reset_requests');
  for (const row of staffResets.rows) {
    const user = users.get(row.user_id);
    await upsert(
      client,
      'staffPasswordResetRequests',
      row.id,
      {
        ...normalizeDocument('staff_password_reset_requests', row),
        displayName: user?.display_name || '',
        role: user?.role || '',
        status: row.status === 'completed' ? 'approved' : row.status,
      },
      row.created_at,
      row.updated_at
    );
  }

  const passwordResets = await client.query(
    `select r.*, s.name as student_name, s.code as student_code,
            active_class.teacher_id
       from password_reset_requests r
       join students s on s.id = r.student_id
       left join lateral (
         select c.teacher_id
           from student_course_enrollments enrollment
           join classes c on c.id = enrollment.class_id
          where enrollment.student_id = r.student_id
            and enrollment.status in ('trial', 'active', 'on_leave')
          order by enrollment.term_start desc
          limit 1
       ) active_class on true`
  );
  for (const row of passwordResets.rows) {
    await upsert(
      client,
      'passwordResetRequests',
      row.id,
      {
        ...normalizeDocument('password_reset_requests', row),
        userId: row.student_code,
        studentName: row.student_name,
        teacherId: row.teacher_id || '',
        method: 'manual_request',
        status: row.status === 'completed' ? 'approved' : row.status,
      },
      row.created_at,
      row.updated_at
    );
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  await client.query('begin');
  const existing = await client.query('select count(*)::int as count from app_documents');
  if (existing.rows[0].count > 0 && !replace) {
    throw new Error('app_documents is not empty; rerun with the explicit --replace confirmation');
  }
  if (replace) await client.query('truncate table app_documents');

  const tables = await client.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`
  );
  let total = 0;
  for (const { table_name: table } of tables.rows) {
    if (EXCLUDED_TABLES.has(table)) continue;
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
    const primary = await client.query(
      `select attribute.attname as column_name
         from pg_index index_info
         join pg_attribute attribute
           on attribute.attrelid = index_info.indrelid
          and attribute.attnum = any(index_info.indkey)
        where index_info.indrelid = $1::regclass and index_info.indisprimary
        order by array_position(index_info.indkey, attribute.attnum)`,
      [table]
    );
    const rows = await client.query(`select * from ${table}`);
    for (const row of rows.rows) {
      const id = documentId(
        table,
        row,
        primary.rows.map((entry) => entry.column_name)
      );
      if (!id) continue;
      let collection = COLLECTION_BY_TABLE.get(table) || table;
      if (table === 'staff_email_access') {
        collection = row.status === 'blocked' ? 'blocked_teachers' : 'allowed_teachers';
      }
      await upsert(
        client,
        collection,
        id,
        normalizeDocument(table, row),
        row.created_at,
        row.updated_at
      );
      total += 1;
    }
  }
  await enrichClasses(client);
  await enrichCourseFeeLedgers(client);
  await enrichCourseClosingRecords(client);
  await enrichFrontendCollections(client);
  await client.query('commit');
  console.log(`Materialized ${total} PostgreSQL rows into app_documents`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
