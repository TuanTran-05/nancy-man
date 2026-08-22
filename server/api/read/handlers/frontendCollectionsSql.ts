import type { Pool } from 'pg';
import type { ApiRequest } from '../../lib/http/types.js';
import { requireRole, type UserContext } from '../../lib/auth/authz.js';

type SqlValue = string | number | boolean | null;

function getLimit(req: ApiRequest, fallback = 100, maximum = 2000): number {
  const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(Math.max(value, 1), maximum);
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function fileType(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || 'pdf';
}

function selectionKey(selection: { dayKey: string; slotId: string }): string {
  return `${selection.dayKey}:${selection.slotId}`;
}

export async function readKnowledgeBankSql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'student', 'parent', 'accounting', 'office']);
  const result = await pool.query(
    `select k.*, uploader.display_name as uploaded_by_name, c.name as class_name
       from knowledge_bank_items k
       join users uploader on uploader.id = k.uploaded_by
       left join classes c on c.id = k.class_id
      order by k.created_at desc
      limit $1`,
    [getLimit(req, 200)]
  );
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.description ? { description: row.description } : {}),
      targetType:
        row.target_type === 'global' && row.program_name ? 'program' : row.target_type,
      ...(row.grade !== null ? { grade: Number(row.grade) } : {}),
      ...(row.program_name ? { programName: row.program_name } : {}),
      ...(row.class_id ? { classId: row.class_id } : {}),
      ...(row.class_name ? { className: row.class_name } : {}),
      uploadedBy: row.uploaded_by,
      uploadedByName: row.uploaded_by_name,
      originalFilename: row.original_filename,
      fileType: row.file_type,
      mimeType: row.mime_type,
      fileSize: Number(row.file_size || 0),
      storagePath: row.storage_path,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      downloadCount: Number(row.download_count || 0),
      lastDownloadedAt: iso(row.last_downloaded_at),
      ...(row.curriculum_family ? { curriculumFamily: row.curriculum_family } : {}),
      unitNumber: row.unit_number === null ? null : Number(row.unit_number),
      resourceKind: row.resource_kind,
    })),
  };
}

export async function readPrintRequestsSql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  const values: SqlValue[] = [];
  const where: string[] = [];
  const add = (clause: string, value: SqlValue) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };
  if (ctx.role === 'teacher') add('pr.teacher_id = ?', ctx.uid);
  if (typeof req.query.status === 'string' && req.query.status && req.query.status !== 'all') {
    add('pr.status = ?', req.query.status);
  }
  if (typeof req.query.neededDate === 'string' && req.query.neededDate) {
    add('pr.needed_by = ?::date', req.query.neededDate);
  }
  if (typeof req.query.createdDate === 'string' && req.query.createdDate) {
    add('pr.created_at::date = ?::date', req.query.createdDate);
  }
  values.push(getLimit(req, 200));
  const result = await pool.query(
    `select pr.*, teacher.display_name as teacher_name, c.name as class_name,
            handler.display_name as handled_by_name,
            coalesce(jsonb_agg(jsonb_build_object(
              'id', f.id,
              'originalFilename', f.original_filename,
              'mimeType', coalesce(f.mime_type, ''),
              'fileSize', coalesce(f.file_size, 0),
              'storagePath', f.storage_path,
              'position', f.position
            ) order by f.position) filter (where f.id is not null), '[]'::jsonb) as files
       from print_requests pr
       join users teacher on teacher.id = pr.teacher_id
       left join classes c on c.id = pr.class_id
       left join users handler on handler.id = pr.handled_by
       left join print_request_files f on f.print_request_id = pr.id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      group by pr.id, teacher.display_name, c.name, handler.display_name
      order by pr.created_at desc
      limit $${values.length}`,
    values
  );
  return {
    requests: result.rows.map((row) => {
      const handledAt = iso(row.handled_at);
      const status = row.status === 'accepted' ? 'pending' : row.status;
      return {
        id: row.id,
        teacherId: row.teacher_id,
        teacherName: row.teacher_name,
        classId: row.class_id || '',
        className: row.class_name || '',
        neededAt: dateOnly(row.needed_by),
        neededDate: dateOnly(row.needed_by),
        createdDate: dateOnly(row.created_at),
        status,
        ...(row.note ? { note: row.note } : {}),
        files: (Array.isArray(row.files) ? row.files : []).map((file) => ({
          ...file,
          fileType: fileType(String(file.originalFilename || '')),
          fileSize: Number(file.fileSize || 0),
          quantity: Number(row.copies || 1),
        })),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        ...(row.handled_by ? { handledBy: row.handled_by } : {}),
        ...(row.handled_by_name ? { handledByName: row.handled_by_name } : {}),
        ...(status === 'printed' && handledAt ? { printedAt: handledAt } : {}),
        ...(status === 'completed' && handledAt ? { completedAt: handledAt } : {}),
        ...(status === 'rejected' && handledAt ? { rejectedAt: handledAt } : {}),
        ...(status === 'cancelled' && handledAt ? { cancelledAt: handledAt } : {}),
      };
    }),
  };
}

type SelectionRow = { owner_id: string; day_key: string; slot_id: string };

async function loadSelections(
  pool: Pool,
  table: 'teacher_availability_profile_selections' | 'teacher_availability_change_request_selections',
  ownerColumn: 'profile_id' | 'request_id',
  ids: string[]
) {
  const byOwner = new Map<string, Array<{ dayKey: string; slotId: string }>>();
  if (!ids.length) return byOwner;
  const result = await pool.query<SelectionRow>(
    `select ${ownerColumn} as owner_id, day_key, slot_id
       from ${table}
      where ${ownerColumn} = any($1::text[])
      order by day_key, slot_id`,
    [ids]
  );
  for (const row of result.rows) {
    const rows = byOwner.get(row.owner_id) || [];
    rows.push({ dayKey: row.day_key, slotId: row.slot_id });
    byOwner.set(row.owner_id, rows);
  }
  return byOwner;
}

export async function readTeacherAvailabilitySql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'office']);
  const view = String(req.query.view || 'profiles');
  const teacherFilter = ctx.role === 'teacher' ? 'and r.teacher_id = $2' : '';
  const values: SqlValue[] = [getLimit(req, 200)];
  if (ctx.role === 'teacher') values.push(ctx.uid);

  if (view === 'profiles') {
    const profiles = await pool.query(
      `select r.*, u.display_name as teacher_name
         from teacher_availability_profiles r
         join users u on u.id = r.teacher_id
        where true ${teacherFilter}
        order by u.display_name
        limit $1`,
      values
    );
    const selections = await loadSelections(
      pool,
      'teacher_availability_profile_selections',
      'profile_id',
      profiles.rows.map((row) => row.id)
    );
    return {
      profiles: profiles.rows.map((row) => {
        const selected = selections.get(row.id) || [];
        return {
          id: row.id,
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          selections: selected,
          selectionKeys: selected.map(selectionKey),
          version: Number(row.version || 1),
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        };
      }),
    };
  }

  if (view !== 'pending') throw Object.assign(new Error('Unknown teacher availability view'), { statusCode: 400 });
  const requests = await pool.query(
    `select r.*, u.display_name as teacher_name, reviewer.display_name as reviewed_by_name
       from teacher_availability_change_requests r
       join users u on u.id = r.teacher_id
       left join users reviewer on reviewer.id = r.reviewed_by
      where r.status = 'pending' ${teacherFilter}
      order by r.requested_at desc
      limit $1`,
    values
  );
  const requested = await loadSelections(
    pool,
    'teacher_availability_change_request_selections',
    'request_id',
    requests.rows.map((row) => row.id)
  );
  const profileIds = requests.rows.map((row) => row.profile_id).filter(Boolean);
  const current = await loadSelections(
    pool,
    'teacher_availability_profile_selections',
    'profile_id',
    profileIds
  );
  return {
    requests: requests.rows.map((row) => {
      const requestedSelections = requested.get(row.id) || [];
      return {
        id: row.id,
        teacherId: row.teacher_id,
        teacherName: row.teacher_name,
        currentSelections: current.get(row.profile_id) || [],
        requestedSelections,
        requestedSelectionKeys: requestedSelections.map(selectionKey),
        reason: row.reason || '',
        status: row.status,
        reviewedBy: row.reviewed_by || undefined,
        reviewedByName: row.reviewed_by_name || undefined,
        reviewedAt: iso(row.reviewed_at),
        createdAt: iso(row.requested_at) || '',
        updatedAt: iso(row.updated_at),
      };
    }),
  };
}

export async function readSubstituteRequestsSql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher', 'accounting', 'office']);
  const values: SqlValue[] = [];
  const where: string[] = [];
  const add = (clause: string, value: SqlValue) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };
  if (ctx.role === 'teacher') {
    values.push(ctx.uid);
    where.push(`(r.status = 'pending' or r.requesting_teacher_id = $${values.length} or r.substitute_teacher_id = $${values.length})`);
  }
  if (typeof req.query.status === 'string' && req.query.status) add('r.status = ?', req.query.status);
  if (typeof req.query.classId === 'string' && req.query.classId) add('r.class_id = ?', req.query.classId);
  if (typeof req.query.date === 'string' && req.query.date) add('r.session_date = ?::date', req.query.date);
  values.push(getLimit(req, 200));
  const result = await pool.query(
    `select r.*, requester.display_name as requesting_teacher_name,
            substitute.display_name as substitute_teacher_name, c.name as class_name
       from substitute_requests r
       join users requester on requester.id = r.requesting_teacher_id
       left join users substitute on substitute.id = r.substitute_teacher_id
       join classes c on c.id = r.class_id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by r.session_date desc, r.created_at desc
      limit $${values.length}`,
    values
  );
  return {
    requests: result.rows.map((row) => ({
      id: row.id,
      requestingTeacherId: row.requesting_teacher_id,
      requestingTeacherName: row.requesting_teacher_name,
      substituteTeacherId: row.substitute_teacher_id || undefined,
      substituteTeacherName: row.substitute_teacher_name || undefined,
      classId: row.class_id,
      className: row.class_name,
      date: dateOnly(row.session_date),
      status: row.status === 'rejected' ? 'cancelled' : row.status,
      reason: row.reason || undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      acceptedAt: row.status === 'accepted' ? iso(row.responded_at) : undefined,
    })),
  };
}

export async function readStaffPasswordResetRequestsSql(
  pool: Pool,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin']);
  const result = await pool.query(
    `select r.*, u.display_name, u.role
       from staff_password_reset_requests r
       join users u on u.id = r.user_id
      order by r.requested_at desc
      limit $1`,
    [getLimit(req, 200)]
  );
  return {
    requests: result.rows.map((row) => ({
      id: row.id,
      uid: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status === 'completed' ? 'approved' : row.status,
      createdAt: iso(row.requested_at),
      updatedAt: iso(row.updated_at),
      requestedBy: row.user_id,
    })),
  };
}

export async function readAdminAccessConfigSql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin']);
  const result = await pool.query(
    `select email, status, added_at, blocked_at
       from staff_email_access
      order by email
      limit $1`,
    [getLimit(req, 2000)]
  );
  return {
    allowedTeachers: result.rows
      .filter((row) => row.status === 'allowed')
      .map((row) => ({ email: row.email, addedAt: iso(row.added_at) || '' })),
    blockedTeachers: result.rows
      .filter((row) => row.status === 'blocked')
      .map((row) => ({ email: row.email, blockedAt: iso(row.blocked_at) || '' })),
  };
}

export async function readStudentDirectoryReferencesSql(
  pool: Pool,
  ctx: UserContext,
  req: ApiRequest
) {
  requireRole(ctx, ['admin', 'teacher']);
  const limit = getLimit(req, 2000);
  const teacherRows =
    ctx.role === 'admin'
      ? await pool.query(
          `select id, display_name from users
            where role = 'teacher' and is_revoked = false
            order by display_name limit $1`,
          [limit]
        )
      : { rows: [] };
  const parentRows = await pool.query(
    `select distinct u.id, u.email, u.display_name, u.bio, u.phone, u.student_id,
            u.force_password_change, u.is_revoked, u.updated_at
       from users u
      where u.role = 'parent'
        and ($2::boolean or exists (
          select 1
            from student_course_enrollments e
            join classes c on c.id = e.class_id
           where e.student_id = u.student_id
             and e.status in ('trial', 'active', 'on_leave')
             and c.teacher_id = $3
        ))
      order by u.display_name
      limit $1`,
    [limit, ctx.role === 'admin', ctx.uid]
  );
  return {
    teachers: teacherRows.rows.map((row) => ({ uid: row.id, displayName: row.display_name })),
    parentProfiles: parentRows.rows.map((row) => ({
      uid: row.id,
      email: row.email || undefined,
      displayName: row.display_name,
      role: 'parent',
      studentId: row.student_id,
      bio: row.bio || undefined,
      phone: row.phone || undefined,
      forcePasswordChange: Boolean(row.force_password_change),
      isRevoked: Boolean(row.is_revoked),
      updatedAt: iso(row.updated_at),
    })),
  };
}

export async function readPasswordResetRequestsSql(pool: Pool, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'teacher']);
  const result = await pool.query(
    `select r.*, s.name as student_name, s.code as student_code,
            active_class.teacher_id
       from password_reset_requests r
       join students s on s.id = r.student_id
       left join lateral (
         select c.teacher_id
           from student_course_enrollments e
           join classes c on c.id = e.class_id
          where e.student_id = r.student_id
            and e.status in ('trial', 'active', 'on_leave')
          order by e.term_start desc
          limit 1
       ) active_class on true
      where ($2::boolean or active_class.teacher_id = $3)
      order by r.requested_at desc
      limit $1`,
    [getLimit(req, 200), ctx.role === 'admin', ctx.uid]
  );
  return {
    requests: result.rows.map((row) => ({
      id: row.id,
      userId: row.student_code,
      studentDocId: row.student_id,
      type: row.scope,
      status: row.status === 'completed' ? 'approved' : row.status,
      createdAt: iso(row.requested_at),
      updatedAt: iso(row.updated_at),
      teacherId: row.teacher_id || '',
      studentName: row.student_name,
      phoneNumber: row.phone_number,
      method: 'manual_request',
    })),
  };
}
