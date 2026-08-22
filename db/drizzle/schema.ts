import { pgTable, foreignKey, check, text, smallint, boolean, timestamp, index, jsonb, unique, time, date, numeric, type AnyPgColumn, uniqueIndex, integer, bigint, inet, pgView, pgMaterializedView, pgSequence } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const receiptNoSeq = pgSequence("receipt_no_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })

export const appDocuments = pgTable("app_documents", {
	collectionPath: text("collection_path").notNull(),
	documentId: text("document_id").notNull(),
	data: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
})

export const studentAuthCredentials = pgTable("student_auth_credentials", {
	studentId: text("student_id").primaryKey().notNull(),
	studentPasswordHash: text("student_password_hash"),
	studentPasswordSalt: text("student_password_salt"),
	studentPasswordVersion: smallint("student_password_version"),
	studentForcePasswordChange: boolean("student_force_password_change").default(false).notNull(),
	parentPasswordHash: text("parent_password_hash"),
	parentPasswordSalt: text("parent_password_salt"),
	parentPasswordVersion: smallint("parent_password_version"),
	parentForcePasswordChange: boolean("parent_force_password_change").default(false).notNull(),
	migratedAt: timestamp("migrated_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "student_auth_credentials_student_id_fkey"
		}).onDelete("cascade"),
	check("parent_secret_complete", sql`num_nulls(parent_password_hash, parent_password_salt) = ANY (ARRAY[0, 2])`),
	check("student_auth_credentials_parent_password_version_check", sql`parent_password_version = ANY (ARRAY[1, 2])`),
	check("student_auth_credentials_student_password_version_check", sql`student_password_version = ANY (ARRAY[1, 2])`),
	check("student_secret_complete", sql`num_nulls(student_password_hash, student_password_salt) = ANY (ARRAY[0, 2])`),
]);

export const staffEmailAccess = pgTable("staff_email_access", {
	email: text().primaryKey().notNull(),
	status: text().notNull(),
	role: text(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }),
	addedByAdmin: boolean("added_by_admin").default(false).notNull(),
	blockedAt: timestamp("blocked_at", { withTimezone: true, mode: 'string' }),
	blockedBy: text("blocked_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.blockedBy],
			foreignColumns: [users.id],
			name: "staff_email_access_blocked_by_fkey"
		}).onDelete("restrict"),
	check("allowed_needs_role", sql`(status = 'blocked'::text) OR (role IS NOT NULL)`),
	check("blocked_needs_time", sql`(status = 'allowed'::text) OR (blocked_at IS NOT NULL)`),
	check("email_is_lowercase", sql`email = lower(btrim(email))`),
	check("staff_email_access_role_check", sql`role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
	check("staff_email_access_status_check", sql`status = ANY (ARRAY['allowed'::text, 'blocked'::text])`),
]);

export const staffAccountRequests = pgTable("staff_account_requests", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	phone: text().notNull(),
	email: text(),
	role: text().notNull(),
	status: text().notNull(),
	reviewedBy: text("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("staff_account_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "staff_account_requests_reviewed_by_fkey"
		}).onDelete("restrict"),
	check("staff_account_requests_role_check", sql`role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
	check("staff_account_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])`),
	check("staff_request_review_pair", sql`(reviewed_at IS NULL) = (reviewed_by IS NULL)`),
]);

export const passwordResetRequests = pgTable("password_reset_requests", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	phoneNumber: text("phone_number").notNull(),
	scope: text().default('student').notNull(),
	status: text().notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedBy: text("resolved_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("password_reset_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	index("password_reset_requests_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.requestedAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.resolvedBy],
			foreignColumns: [users.id],
			name: "password_reset_requests_resolved_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "password_reset_requests_student_id_fkey"
		}).onDelete("restrict"),
	check("password_reset_requests_scope_check", sql`scope = ANY (ARRAY['student'::text, 'parent'::text])`),
	check("password_reset_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text])`),
	check("password_reset_resolution_pair", sql`(resolved_at IS NULL) = (resolved_by IS NULL)`),
]);

export const staffPasswordResetRequests = pgTable("staff_password_reset_requests", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	email: text().notNull(),
	status: text().notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedBy: text("resolved_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("staff_password_reset_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	foreignKey({
			columns: [table.resolvedBy],
			foreignColumns: [users.id],
			name: "staff_password_reset_requests_resolved_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "staff_password_reset_requests_user_id_fkey"
		}).onDelete("restrict"),
	check("staff_password_reset_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text])`),
]);

export const teacherRegistrationRequests = pgTable("teacher_registration_requests", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	displayName: text("display_name"),
	phone: text(),
	status: text().notNull(),
	reviewedBy: text("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "teacher_registration_requests_reviewed_by_fkey"
		}).onDelete("restrict"),
	check("teacher_registration_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])`),
]);

export const admissionsHistory = pgTable("admissions_history", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id"),
	teacherId: text("teacher_id"),
	action: text().notNull(),
	actorId: text("actor_id"),
	actorRole: text("actor_role"),
	note: text(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admissions_history_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "admissions_history_actor_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "admissions_history_class_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "admissions_history_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "admissions_history_teacher_id_fkey"
		}).onDelete("restrict"),
	check("admissions_history_action_check", sql`action = ANY (ARRAY['added_to_waitlist'::text, 'class_changed'::text, 'admitted'::text, 'rejected'::text])`),
]);

export const studentProgressionEvents = pgTable("student_progression_events", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	fromClassId: text("from_class_id"),
	toClassId: text("to_class_id"),
	eventType: text("event_type").notNull(),
	operationId: text("operation_id"),
	actorId: text("actor_id"),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("student_progression_events_op_idx").using("btree", table.operationId.asc().nullsLast().op("text_ops")).where(sql`(operation_id IS NOT NULL)`),
	index("student_progression_events_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "student_progression_events_actor_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "student_progression_events_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.fromClassId],
			foreignColumns: [classes.id],
			name: "student_progression_from_class_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.toClassId],
			foreignColumns: [classes.id],
			name: "student_progression_to_class_fkey"
		}).onDelete("restrict"),
]);

export const schemaMigrations = pgTable("schema_migrations", {
	filename: text().primaryKey().notNull(),
	checksum: text().notNull(),
	status: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	error: text(),
}, (table) => [
	check("schema_migrations_status_check", sql`status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])`),
]);

export const systemSettings = pgTable("system_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	updatedBy: text("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "system_settings_updated_by_fkey"
		}).onDelete("restrict"),
]);

export const maintenanceFlags = pgTable("maintenance_flags", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	ranAt: timestamp("ran_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const classTermWeeklySessions = pgTable("class_term_weekly_sessions", {
	id: text().primaryKey().notNull(),
	termId: text("term_id").notNull(),
	dayOfWeek: smallint("day_of_week").notNull(),
	startTime: time("start_time").notNull(),
	endTime: time("end_time").notNull(),
	room: text(),
}, (table) => [
	index("class_term_weekly_sessions_term_idx").using("btree", table.termId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "class_term_weekly_sessions_term_id_fkey"
		}).onDelete("cascade"),
	unique("weekly_session_slot_key").on(table.termId, table.dayOfWeek, table.startTime),
	check("class_term_weekly_sessions_day_of_week_check", sql`(day_of_week >= 0) AND (day_of_week <= 6)`),
	check("weekly_session_time_order", sql`end_time > start_time`),
]);

export const classHolidays = pgTable("class_holidays", {
	id: text().primaryKey().notNull(),
	termId: text("term_id").notNull(),
	holidayDate: date("holiday_date").notNull(),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "class_holidays_term_id_fkey"
		}).onDelete("cascade"),
	unique("class_holiday_key").on(table.termId, table.holidayDate),
]);

export const classSessions = pgTable("class_sessions", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	termId: text("term_id"),
	sessionDate: date("session_date").notNull(),
	teacherId: text("teacher_id").notNull(),
	status: text().default('taught').notNull(),
	salaryPerSession: numeric("salary_per_session", { precision: 14, scale:  2 }).default('0').notNull(),
	teacherAttendanceStatus: text("teacher_attendance_status"),
	teacherAttendanceMarkedAt: timestamp("teacher_attendance_marked_at", { withTimezone: true, mode: 'string' }),
	teacherAttendanceMarkedBy: text("teacher_attendance_marked_by"),
	teacherAttendanceMarkedByRole: text("teacher_attendance_marked_by_role"),
	teacherAttendanceNote: text("teacher_attendance_note"),
	teacherAttendanceSource: text("teacher_attendance_source"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("class_sessions_class_date_idx").using("btree", table.classId.asc().nullsLast().op("date_ops"), table.sessionDate.desc().nullsFirst().op("text_ops")),
	index("class_sessions_teacher_idx").using("btree", table.teacherId.asc().nullsLast().op("date_ops"), table.sessionDate.desc().nullsFirst().op("date_ops")),
	index("class_sessions_term_idx").using("btree", table.termId.asc().nullsLast().op("text_ops")).where(sql`(term_id IS NOT NULL)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "class_sessions_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "class_sessions_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "class_sessions_term_id_fkey"
		}).onDelete("restrict"),
	unique("class_sessions_date_key").on(table.classId, table.sessionDate),
	check("class_sessions_salary_per_session_check", sql`salary_per_session >= (0)::numeric`),
	check("class_sessions_status_check", sql`status = ANY (ARRAY['taught'::text, 'cancelled'::text, 'holiday'::text])`),
	check("class_sessions_teacher_attendance_marked_by_role_check", sql`teacher_attendance_marked_by_role = ANY (ARRAY['admin'::text, 'office'::text])`),
	check("class_sessions_teacher_attendance_source_check", sql`teacher_attendance_source = ANY (ARRAY['office_admin'::text, 'promotion_backfill'::text])`),
	check("class_sessions_teacher_attendance_status_check", sql`teacher_attendance_status = ANY (ARRAY['present'::text, 'absent'::text, 'substituted'::text])`),
	check("teacher_attendance_complete", sql`(teacher_attendance_status IS NULL) OR ((teacher_attendance_marked_at IS NOT NULL) AND (teacher_attendance_marked_by IS NOT NULL))`),
]);

export const classes = pgTable("classes", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	room: text().default('').notNull(),
	teacherId: text("teacher_id").notNull(),
	status: text().default('active').notNull(),
	grade: smallint(),
	salaryPerSession: numeric("salary_per_session", { precision: 14, scale:  2 }).default('0').notNull(),
	currency: text().default('VND').notNull(),
	importSourceClassId: text("import_source_class_id"),
	promotedAt: timestamp("promoted_at", { withTimezone: true, mode: 'string' }),
	promotionSourceClassName: text("promotion_source_class_name"),
	promotionSourceTeacherName: text("promotion_source_teacher_name"),
	promotionNote: text("promotion_note"),
	promotionRecordedAt: timestamp("promotion_recorded_at", { withTimezone: true, mode: 'string' }),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	archivedBy: text("archived_by"),
	archiveReason: text("archive_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("classes_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("classes_teacher_idx").using("btree", table.teacherId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.archivedBy],
			foreignColumns: [users.id],
			name: "classes_archived_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.importSourceClassId],
			foreignColumns: [table.id],
			name: "classes_import_source_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "classes_teacher_id_fkey"
		}).onDelete("restrict"),
	check("classes_archive_pair", sql`(status = 'archived'::text) OR ((archived_at IS NULL) AND (archived_by IS NULL))`),
	check("classes_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("classes_grade_check", sql`(grade >= 1) AND (grade <= 12)`),
	check("classes_salary_per_session_check", sql`salary_per_session >= (0)::numeric`),
	check("classes_status_check", sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])`),
]);

export const classTerms = pgTable("class_terms", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	courseId: text("course_id"),
	name: text(),
	termStart: date("term_start").notNull(),
	termEnd: date("term_end"),
	tuitionFee: numeric("tuition_fee", { precision: 14, scale:  2 }),
	currency: text().default('VND').notNull(),
	startTime: time("start_time"),
	daysOfWeek: smallint("days_of_week").array().default([]).notNull(),
	resetOperationId: text("reset_operation_id"),
	repairSource: text("repair_source"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("class_terms_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.termStart.desc().nullsFirst().op("date_ops")),
	index("class_terms_course_id_idx").using("btree", table.courseId.asc().nullsLast().op("text_ops")).where(sql`(course_id IS NOT NULL)`),
	index("class_terms_open_idx").using("btree", table.classId.asc().nullsLast().op("text_ops")).where(sql`(term_end IS NULL)`),
	index("class_terms_range_idx").using("gist", sql`class_id`, sql`daterange(term_start, term_end, '[]'::text)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "class_terms_class_id_fkey"
		}).onDelete("restrict"),
	unique("class_terms_class_start_key").on(table.classId, table.termStart),
	check("class_terms_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("class_terms_days_valid", sql`days_of_week <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]`),
	check("class_terms_order", sql`(term_end IS NULL) OR (term_end >= term_start)`),
	check("class_terms_tuition_fee_check", sql`tuition_fee >= (0)::numeric`),
]);

export const students = pgTable("students", {
	id: text().primaryKey().notNull(),
	code: text().notNull(),
	codeNormalized: text("code_normalized").generatedAlwaysAs(sql`app_normalize_code(code)`),
	name: text().notNull(),
	nameNormalized: text("name_normalized").generatedAlwaysAs(sql`app_normalize_text(name)`),
	dob: date(),
	contact: text(),
	gender: text(),
	grade: smallint(),
	studentLifecycle: text("student_lifecycle").default('enrolled').notNull(),
	admissionStatus: text("admission_status"),
	admittedAt: timestamp("admitted_at", { withTimezone: true, mode: 'string' }),
	admittedBy: text("admitted_by"),
	enrollmentDate: date("enrollment_date"),
	trialClassId: text("trial_class_id"),
	trialTeacherId: text("trial_teacher_id"),
	trialStartedAt: timestamp("trial_started_at", { withTimezone: true, mode: 'string' }),
	trialSessionCount: integer("trial_session_count").default(0).notNull(),
	trialRequiredSessions: integer("trial_required_sessions"),
	trialReviewStatus: text("trial_review_status"),
	faceImageStoragePath: text("face_image_storage_path"),
	isRevoked: boolean("is_revoked").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("students_code_normalized_key").using("btree", table.codeNormalized.asc().nullsLast().op("text_ops")),
	index("students_contact_idx").using("btree", table.contact.asc().nullsLast().op("text_ops")),
	index("students_dob_idx").using("btree", table.dob.asc().nullsLast().op("date_ops")),
	index("students_lifecycle_idx").using("btree", table.studentLifecycle.asc().nullsLast().op("text_ops")),
	index("students_name_trgm_idx").using("gin", table.nameNormalized.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.admittedBy],
			foreignColumns: [users.id],
			name: "students_admitted_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.trialClassId],
			foreignColumns: [classes.id],
			name: "students_trial_class_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.trialTeacherId],
			foreignColumns: [users.id],
			name: "students_trial_teacher_fkey"
		}).onDelete("restrict"),
	check("students_admission_status_check", sql`admission_status = ANY (ARRAY['pending'::text, 'trial'::text, 'accepted'::text, 'rejected'::text])`),
	check("students_admitted_pair", sql`(admitted_at IS NULL) = (admitted_by IS NULL)`),
	check("students_code_shape", sql`btrim(code) <> ''::text`),
	check("students_gender_check", sql`gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])`),
	check("students_grade_check", sql`(grade >= 1) AND (grade <= 12)`),
	check("students_student_lifecycle_check", sql`student_lifecycle = ANY (ARRAY['pending'::text, 'lead'::text, 'trial'::text, 'enrolled'::text, 'archived'::text])`),
	check("students_trial_pair", sql`(trial_class_id IS NULL) OR (trial_started_at IS NOT NULL)`),
	check("students_trial_required_sessions_check", sql`trial_required_sessions > 0`),
	check("students_trial_review_status_check", sql`trial_review_status = ANY (ARRAY['pending_sessions'::text, 'pending_teacher_review'::text, 'accepted'::text, 'rejected'::text])`),
	check("students_trial_session_count_check", sql`trial_session_count >= 0`),
]);

export const users = pgTable("users", {
	id: text().primaryKey().notNull(),
	email: text(),
	displayName: text("display_name").notNull(),
	bio: text(),
	role: text().notNull(),
	phone: text(),
	studentId: text("student_id"),
	forcePasswordChange: boolean("force_password_change").default(false).notNull(),
	isRevoked: boolean("is_revoked").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("users_email_key").using("btree", sql`lower(email)`).where(sql`(email IS NOT NULL)`),
	index("users_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")).where(sql`(phone IS NOT NULL)`),
	index("users_role_idx").using("btree", table.role.asc().nullsLast().op("text_ops")),
	index("users_student_id_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "users_student_id_fkey"
		}).onDelete("restrict"),
	check("users_role_check", sql`role = ANY (ARRAY['teacher'::text, 'student'::text, 'parent'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
	check("users_student_link", sql`(role <> ALL (ARRAY['student'::text, 'parent'::text])) OR (student_id IS NOT NULL)`),
]);

export const studentCourseEnrollments = pgTable("student_course_enrollments", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	termId: text("term_id"),
	termStart: date("term_start").notNull(),
	termEnd: date("term_end"),
	status: text().notNull(),
	joinedAt: date("joined_at").notNull(),
	endedAt: date("ended_at"),
	statusReason: text("status_reason"),
	source: text().notNull(),
	confidence: text().notNull(),
	statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: 'string' }).notNull(),
	statusChangedBy: text("status_changed_by").notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	confirmedBy: text("confirmed_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("enrollment_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.termStart.desc().nullsFirst().op("text_ops")),
	index("enrollment_open_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text]))`),
	index("enrollment_student_idx").using("btree", table.studentId.asc().nullsLast().op("date_ops"), table.termStart.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "student_course_enrollments_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "student_course_enrollments_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "student_course_enrollments_term_id_fkey"
		}).onDelete("restrict"),
	unique("enrollment_term_key").on(table.studentId, table.classId, table.termStart),
	check("enrollment_confirm_pair", sql`(confirmed_at IS NULL) = (confirmed_by IS NULL)`),
	check("enrollment_joined_in_term", sql`(joined_at >= term_start) AND ((term_end IS NULL) OR (joined_at <= term_end))`),
	check("enrollment_open_has_no_end", sql`((status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text])) AND (ended_at IS NULL)) OR ((status = ANY (ARRAY['completed'::text, 'transferred'::text, 'dropped'::text])) AND (ended_at IS NOT NULL) AND (ended_at >= joined_at))`),
	check("enrollment_term_order", sql`(term_end IS NULL) OR (term_end >= term_start)`),
	check("student_course_enrollments_confidence_check", sql`confidence = ANY (ARRAY['confirmed'::text, 'inferred'::text])`),
	check("student_course_enrollments_source_check", sql`source = ANY (ARRAY['system'::text, 'backfill'::text, 'manual'::text])`),
	check("student_course_enrollments_status_check", sql`status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text, 'completed'::text, 'transferred'::text, 'dropped'::text])`),
]);

export const studentLeavePeriods = pgTable("student_leave_periods", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id"),
	leaveFrom: date("leave_from").notNull(),
	leaveUntil: date("leave_until"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("student_leave_periods_student_idx").using("btree", table.studentId.asc().nullsLast().op("date_ops"), table.leaveFrom.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "student_leave_periods_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "student_leave_periods_student_id_fkey"
		}).onDelete("restrict"),
	check("leave_period_order", sql`(leave_until IS NULL) OR (leave_until >= leave_from)`),
]);

export const attendance = pgTable("attendance", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	enrollmentId: text("enrollment_id"),
	sessionId: text("session_id"),
	attendanceDate: date("attendance_date").notNull(),
	status: text().notNull(),
	teacherId: text("teacher_id").notNull(),
	permission: boolean().default(false).notNull(),
	minutesLate: integer("minutes_late"),
	isVoided: boolean("is_voided").default(false).notNull(),
	voidReason: text("void_reason"),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidedBy: text("voided_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("attendance_class_date_idx").using("btree", table.classId.asc().nullsLast().op("date_ops"), table.attendanceDate.desc().nullsFirst().op("text_ops")),
	index("attendance_live_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.attendanceDate.asc().nullsLast().op("text_ops")).where(sql`(is_voided = false)`),
	index("attendance_student_date_idx").using("btree", table.studentId.asc().nullsLast().op("date_ops"), table.attendanceDate.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "attendance_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.enrollmentId],
			foreignColumns: [studentCourseEnrollments.id],
			name: "attendance_enrollment_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [classSessions.id],
			name: "attendance_session_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "attendance_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "attendance_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.voidedBy],
			foreignColumns: [users.id],
			name: "attendance_voided_by_fkey"
		}).onDelete("restrict"),
	unique("attendance_day_key").on(table.studentId, table.classId, table.attendanceDate),
	check("attendance_minutes_late_check", sql`minutes_late >= 0`),
	check("attendance_status_check", sql`status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text])`),
	check("attendance_void_complete", sql`(is_voided = false) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL))`),
]);

export const evaluations = pgTable("evaluations", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	termId: text("term_id"),
	teacherId: text("teacher_id").notNull(),
	evaluationType: text("evaluation_type").default('final').notNull(),
	evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: 'string' }).notNull(),
	termStart: date("term_start"),
	termEnd: date("term_end"),
	scoreAttendance: smallint("score_attendance").notNull(),
	scoreBehavior: smallint("score_behavior").notNull(),
	scoreEffort: smallint("score_effort").notNull(),
	scoreHomework: smallint("score_homework").notNull(),
	scorePronunciation: smallint("score_pronunciation").notNull(),
	finalScore: smallint("final_score").notNull(),
	totalScore: smallint("total_score").notNull(),
	rank: text(),
	positivePoints: text("positive_points").array().default([""]).notNull(),
	improvementPoints: text("improvement_points").default('').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("evaluations_class_idx").using("btree", table.classId.asc().nullsLast().op("timestamptz_ops"), table.evaluatedAt.desc().nullsFirst().op("text_ops")),
	index("evaluations_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.evaluatedAt.desc().nullsFirst().op("text_ops")),
	index("evaluations_term_idx").using("btree", table.termId.asc().nullsLast().op("text_ops")).where(sql`(term_id IS NOT NULL)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "evaluations_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "evaluations_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "evaluations_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "evaluations_term_id_fkey"
		}).onDelete("restrict"),
	unique("evaluation_term_key").on(table.studentId, table.classId, table.evaluationType, table.termStart),
	check("evaluation_term_order", sql`(term_end IS NULL) OR (term_start IS NULL) OR (term_end >= term_start)`),
	check("evaluations_evaluation_type_check", sql`evaluation_type = ANY (ARRAY['midterm'::text, 'final'::text])`),
	check("evaluations_final_score_check", sql`(final_score >= 0) AND (final_score <= 100)`),
	check("evaluations_rank_check", sql`rank = ANY (ARRAY['first'::text, 'second'::text, 'none'::text])`),
	check("evaluations_score_attendance_check", sql`(score_attendance >= 0) AND (score_attendance <= 100)`),
	check("evaluations_score_behavior_check", sql`(score_behavior >= 0) AND (score_behavior <= 100)`),
	check("evaluations_score_effort_check", sql`(score_effort >= 0) AND (score_effort <= 100)`),
	check("evaluations_score_homework_check", sql`(score_homework >= 0) AND (score_homework <= 100)`),
	check("evaluations_score_pronunciation_check", sql`(score_pronunciation >= 0) AND (score_pronunciation <= 100)`),
	check("evaluations_total_score_check", sql`(total_score >= 0) AND (total_score <= 100)`),
]);

export const dailyReports = pgTable("daily_reports", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	teacherId: text("teacher_id").notNull(),
	reportDate: date("report_date").notNull(),
	generalComment: text("general_comment").default('').notNull(),
	additionalNotes: text("additional_notes").default('').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "daily_reports_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "daily_reports_teacher_id_fkey"
		}).onDelete("restrict"),
	unique("daily_report_key").on(table.classId, table.reportDate),
]);

export const submissions = pgTable("submissions", {
	id: text().primaryKey().notNull(),
	assignmentId: text("assignment_id").notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	teacherId: text("teacher_id").notNull(),
	attemptNumber: smallint("attempt_number").notNull(),
	content: text().default('').notNull(),
	grade: numeric({ precision: 5, scale:  2 }),
	status: text().notNull(),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }).notNull(),
	integritySessionStartedAt: timestamp("integrity_session_started_at", { withTimezone: true, mode: 'string' }),
	integrityTabSwitchCount: integer("integrity_tab_switch_count").default(0).notNull(),
	integrityFocusLossCount: integer("integrity_focus_loss_count").default(0).notNull(),
	integrityFullscreenExitCount: integer("integrity_fullscreen_exit_count").default(0).notNull(),
	integrityAutoSubmitted: boolean("integrity_auto_submitted").default(false).notNull(),
	integrityAutoSubmitReason: text("integrity_auto_submit_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("submissions_assignment_idx").using("btree", table.assignmentId.asc().nullsLast().op("text_ops"), table.submittedAt.desc().nullsFirst().op("text_ops")),
	index("submissions_attempt_idx").using("btree", table.assignmentId.asc().nullsLast().op("text_ops"), table.studentId.asc().nullsLast().op("int2_ops"), table.attemptNumber.asc().nullsLast().op("int2_ops")),
	index("submissions_student_idx").using("btree", table.studentId.asc().nullsLast().op("timestamptz_ops"), table.submittedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.assignmentId],
			foreignColumns: [assignments.id],
			name: "submissions_assignment_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "submissions_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "submissions_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "submissions_teacher_id_fkey"
		}).onDelete("restrict"),
	check("submission_auto_reason", sql`(integrity_auto_submitted = false) OR (integrity_auto_submit_reason IS NOT NULL)`),
	check("submissions_attempt_number_check", sql`attempt_number > 0`),
	check("submissions_grade_check", sql`grade >= (0)::numeric`),
	check("submissions_integrity_focus_loss_count_check", sql`integrity_focus_loss_count >= 0`),
	check("submissions_integrity_fullscreen_exit_count_check", sql`integrity_fullscreen_exit_count >= 0`),
	check("submissions_integrity_tab_switch_count_check", sql`integrity_tab_switch_count >= 0`),
	check("submissions_status_check", sql`status = ANY (ARRAY['submitted'::text, 'graded'::text, 'returned'::text])`),
]);

export const substituteRequests = pgTable("substitute_requests", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	sessionId: text("session_id"),
	requestingTeacherId: text("requesting_teacher_id").notNull(),
	substituteTeacherId: text("substitute_teacher_id"),
	sessionDate: date("session_date").notNull(),
	reason: text(),
	status: text().notNull(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	respondedBy: text("responded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("substitute_requests_class_idx").using("btree", table.classId.asc().nullsLast().op("date_ops"), table.sessionDate.desc().nullsFirst().op("date_ops")),
	index("substitute_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "substitute_requests_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.requestingTeacherId],
			foreignColumns: [users.id],
			name: "substitute_requests_requesting_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.respondedBy],
			foreignColumns: [users.id],
			name: "substitute_requests_responded_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [classSessions.id],
			name: "substitute_requests_session_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.substituteTeacherId],
			foreignColumns: [users.id],
			name: "substitute_requests_substitute_teacher_id_fkey"
		}).onDelete("restrict"),
	check("substitute_accepted_has_teacher", sql`(status <> 'accepted'::text) OR (substitute_teacher_id IS NOT NULL)`),
	check("substitute_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text])`),
	check("substitute_response_pair", sql`(responded_at IS NULL) = (responded_by IS NULL)`),
]);

export const assignments = pgTable("assignments", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	teacherId: text("teacher_id").notNull(),
	title: text().notNull(),
	description: text().default('').notNull(),
	type: text().notNull(),
	dueDate: timestamp("due_date", { withTimezone: true, mode: 'string' }),
	attemptsAllowed: smallint("attempts_allowed").default(1).notNull(),
	assessment: jsonb(),
	deliveryPolicy: jsonb("delivery_policy"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("assignments_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.dueDate.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "assignments_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "assignments_teacher_id_fkey"
		}).onDelete("restrict"),
	check("assignments_attempts_allowed_check", sql`attempts_allowed > 0`),
	check("assignments_type_check", sql`type = ANY (ARRAY['quiz'::text, 'essay'::text, 'assessment'::text])`),
]);

export const assignmentQuestions = pgTable("assignment_questions", {
	id: text().primaryKey().notNull(),
	assignmentId: text("assignment_id").notNull(),
	position: smallint().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	legacyQuestionKey: bigint("legacy_question_key", { mode: "number" }),
	questionContent: text("question_content").notNull(),
	level: text(),
	correctAnswer: text("correct_answer").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.id, table.correctAnswer],
			foreignColumns: [assignmentQuestionOptions.questionId, assignmentQuestionOptions.optionKey],
			name: "assignment_question_answer_exists"
		}),
	foreignKey({
			columns: [table.assignmentId],
			foreignColumns: [assignments.id],
			name: "assignment_questions_assignment_id_fkey"
		}).onDelete("cascade"),
	unique("assignment_question_position_key").on(table.assignmentId, table.position),
	unique("assignment_question_legacy_key").on(table.assignmentId, table.legacyQuestionKey),
	check("assignment_questions_level_check", sql`level = ANY (ARRAY['Nhận biết'::text, 'Thông hiểu'::text, 'Vận dụng thấp'::text, 'Vận dụng cao'::text])`),
	check("assignment_questions_position_check", sql`"position" > 0`),
]);

export const assignmentQuestionOptions = pgTable("assignment_question_options", {
	id: text().primaryKey().notNull(),
	questionId: text("question_id").notNull(),
	optionKey: text("option_key").notNull(),
	optionText: text("option_text").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [assignmentQuestions.id],
			name: "assignment_question_options_question_id_fkey"
		}).onDelete("cascade"),
	unique("assignment_option_key").on(table.questionId, table.optionKey),
]);

export const submissionQuizAnswers = pgTable("submission_quiz_answers", {
	id: text().primaryKey().notNull(),
	submissionId: text("submission_id").notNull(),
	questionId: text("question_id").notNull(),
	selectedOption: text("selected_option"),
}, (table) => [
	index("submission_quiz_answers_question_idx").using("btree", table.questionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [assignmentQuestions.id],
			name: "submission_quiz_answers_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissions.id],
			name: "submission_quiz_answers_submission_id_fkey"
		}).onDelete("cascade"),
	unique("submission_answer_key").on(table.submissionId, table.questionId),
]);

export const submissionAssessmentAnswers = pgTable("submission_assessment_answers", {
	id: text().primaryKey().notNull(),
	submissionId: text("submission_id").notNull(),
	criterionKey: text("criterion_key").notNull(),
	score: numeric({ precision: 6, scale:  2 }),
	comment: text(),
}, (table) => [
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [submissions.id],
			name: "submission_assessment_answers_submission_id_fkey"
		}).onDelete("cascade"),
	unique("submission_assessment_key").on(table.submissionId, table.criterionKey),
]);

export const knowledgeBankItems = pgTable("knowledge_bank_items", {
	id: text().primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	resourceKind: text("resource_kind").notNull(),
	targetType: text("target_type").notNull(),
	classId: text("class_id"),
	grade: smallint(),
	curriculumFamily: text("curriculum_family"),
	programName: text("program_name"),
	unitNumber: smallint("unit_number"),
	storagePath: text("storage_path").notNull(),
	originalFilename: text("original_filename").notNull(),
	fileType: text("file_type").notNull(),
	mimeType: text("mime_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSize: bigint("file_size", { mode: "number" }).notNull(),
	downloadCount: integer("download_count").default(0).notNull(),
	lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true, mode: 'string' }),
	uploadedBy: text("uploaded_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("knowledge_bank_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops")).where(sql`(class_id IS NOT NULL)`),
	index("knowledge_bank_grade_idx").using("btree", table.grade.asc().nullsLast().op("int2_ops"), table.unitNumber.asc().nullsLast().op("int2_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "knowledge_bank_items_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "knowledge_bank_items_uploaded_by_fkey"
		}).onDelete("restrict"),
	check("knowledge_bank_items_download_count_check", sql`download_count >= 0`),
	check("knowledge_bank_items_file_size_check", sql`file_size >= 0`),
	check("knowledge_bank_items_grade_check", sql`(grade >= 1) AND (grade <= 12)`),
	check("knowledge_bank_items_resource_kind_check", sql`resource_kind = ANY (ARRAY['document'::text, 'video'::text, 'audio'::text, 'link'::text])`),
	check("knowledge_bank_items_target_type_check", sql`target_type = ANY (ARRAY['grade'::text, 'class'::text, 'global'::text])`),
	check("knowledge_bank_items_unit_number_check", sql`unit_number > 0`),
	check("knowledge_target_shape", sql`((target_type = 'grade'::text) AND (grade IS NOT NULL)) OR ((target_type = 'class'::text) AND (class_id IS NOT NULL)) OR (target_type = 'global'::text)`),
]);

export const curriculums = pgTable("curriculums", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	grade: smallint(),
	data: jsonb().default({}).notNull(),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "curriculums_created_by_fkey"
		}).onDelete("restrict"),
	check("curriculums_grade_check", sql`(grade >= 1) AND (grade <= 12)`),
]);

export const courseFeeLedgers = pgTable("course_fee_ledgers", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	enrollmentId: text("enrollment_id"),
	termId: text("term_id"),
	termStart: date("term_start"),
	termEnd: date("term_end"),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	status: text().notNull(),
	periodType: text("period_type"),
	month: text(),
	source: text(),
	dueDate: date("due_date"),
	note: text(),
	legacyTuitionRecordId: text("legacy_tuition_record_id"),
	migrationRunId: text("migration_run_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ledger_class_idx").using("btree", table.classId.asc().nullsLast().op("date_ops"), table.termStart.desc().nullsFirst().op("text_ops")),
	index("ledger_enrollment_idx").using("btree", table.enrollmentId.asc().nullsLast().op("text_ops")).where(sql`(enrollment_id IS NOT NULL)`),
	index("ledger_open_idx").using("btree", table.status.asc().nullsLast().op("date_ops"), table.dueDate.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['unpaid'::text, 'partial'::text]))`),
	index("ledger_student_idx").using("btree", table.studentId.asc().nullsLast().op("date_ops"), table.termStart.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "course_fee_ledgers_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.enrollmentId],
			foreignColumns: [studentCourseEnrollments.id],
			name: "course_fee_ledgers_enrollment_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "course_fee_ledgers_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "course_fee_ledgers_term_id_fkey"
		}).onDelete("restrict"),
	unique("ledger_term_key").on(table.studentId, table.classId, table.termStart),
	check("course_fee_ledgers_amount_check", sql`amount >= (0)::numeric`),
	check("course_fee_ledgers_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("course_fee_ledgers_month_check", sql`(month IS NULL) OR (month ~ '^\d{4}-\d{2}$'::text)`),
	check("course_fee_ledgers_period_type_check", sql`period_type = ANY (ARRAY['course'::text, 'monthly'::text])`),
	check("course_fee_ledgers_source_check", sql`source = ANY (ARRAY['course'::text, 'legacy_tuition'::text])`),
	check("course_fee_ledgers_status_check", sql`status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'waived'::text])`),
	check("ledger_period_shape", sql`(period_type IS NULL) OR ((period_type = 'monthly'::text) AND (month IS NOT NULL)) OR ((period_type = 'course'::text) AND (term_start IS NOT NULL))`),
	check("ledger_term_order", sql`(term_end IS NULL) OR (term_start IS NULL) OR (term_end >= term_start)`),
]);

export const examBank = pgTable("exam_bank", {
	id: text().primaryKey().notNull(),
	title: text().notNull(),
	grade: smallint(),
	data: jsonb().default({}).notNull(),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "exam_bank_created_by_fkey"
		}).onDelete("restrict"),
	check("exam_bank_grade_check", sql`(grade >= 1) AND (grade <= 12)`),
]);

export const examTemplates = pgTable("exam_templates", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	data: jsonb().default({}).notNull(),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "exam_templates_created_by_fkey"
		}).onDelete("restrict"),
]);

export const ledgerNoticeLog = pgTable("ledger_notice_log", {
	id: text().primaryKey().notNull(),
	ledgerId: text("ledger_id").notNull(),
	noticeKind: text("notice_kind").notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).notNull(),
	sentBy: text("sent_by").notNull(),
	source: text(),
	amount: numeric({ precision: 14, scale:  2 }),
	dueDate: date("due_date"),
	semester: text(),
	messageId: text("message_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ledger_notice_log_ledger_idx").using("btree", table.ledgerId.asc().nullsLast().op("text_ops"), table.sentAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "ledger_notice_log_ledger_id_fkey"
		}).onDelete("restrict"),
	check("ledger_notice_log_amount_check", sql`amount >= (0)::numeric`),
	check("ledger_notice_log_notice_kind_check", sql`notice_kind = ANY (ARRAY['reminder'::text, 'notice'::text])`),
	check("ledger_notice_log_source_check", sql`source = ANY (ARRAY['evaluation'::text, 'accounting'::text, 'office'::text, 'system'::text])`),
]);

export const studentWallets = pgTable("student_wallets", {
	studentId: text("student_id").primaryKey().notNull(),
	openingBalance: numeric("opening_balance", { precision: 14, scale:  2 }).default('0').notNull(),
	historyStartedAt: date("history_started_at"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "student_wallets_student_id_fkey"
		}).onDelete("restrict"),
]);

export const receipts = pgTable("receipts", {
	id: text().primaryKey().notNull(),
	receiptNo: text("receipt_no").notNull(),
	type: text().default('tuition').notNull(),
	walletDeposit: boolean("wallet_deposit").default(false).notNull(),
	flowVersion: text("flow_version"),
	transactionGroupId: text("transaction_group_id"),
	studentId: text("student_id").notNull(),
	classId: text("class_id"),
	ledgerId: text("ledger_id"),
	invoiceId: text("invoice_id"),
	amountReceived: numeric("amount_received", { precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	paymentMethod: text("payment_method").notNull(),
	receivedDate: date("received_date").notNull(),
	status: text().notNull(),
	note: text().default('').notNull(),
	source: text(),
	paymentRequestId: text("payment_request_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	payosOrderCode: bigint("payos_order_code", { mode: "number" }),
	payosPaymentLinkId: text("payos_payment_link_id"),
	payosReference: text("payos_reference"),
	paymentConfirmationSource: text("payment_confirmation_source"),
	notificationSkippedReason: text("notification_skipped_reason"),
	createdBy: text("created_by").notNull(),
	createdByRole: text("created_by_role").notNull(),
	voidReason: text("void_reason"),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidedBy: text("voided_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("receipts_date_idx").using("btree", table.receivedDate.desc().nullsFirst().op("date_ops")).where(sql`(status = 'posted'::text)`),
	index("receipts_group_idx").using("btree", table.transactionGroupId.asc().nullsLast().op("text_ops")).where(sql`(transaction_group_id IS NOT NULL)`),
	index("receipts_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.receivedDate.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "receipts_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "receipts_created_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "receipts_invoice_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "receipts_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.paymentRequestId],
			foreignColumns: [paymentRequests.id],
			name: "receipts_payment_request_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "receipts_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.voidedBy],
			foreignColumns: [users.id],
			name: "receipts_voided_by_fkey"
		}).onDelete("restrict"),
	unique("receipts_receipt_no_key").on(table.receiptNo),
	check("receipt_void_complete", sql`(status <> 'void'::text) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL))`),
	check("receipts_amount_received_check", sql`amount_received >= (0)::numeric`),
	check("receipts_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("receipts_payment_confirmation_source_check", sql`payment_confirmation_source = ANY (ARRAY['webhook'::text, 'gateway_status'::text, 'gateway_reconcile'::text])`),
	check("receipts_payment_method_check", sql`payment_method = ANY (ARRAY['cash'::text, 'transfer'::text, 'other'::text])`),
	check("receipts_source_check", sql`source = ANY (ARRAY['manual'::text, 'payos'::text, 'migration'::text])`),
	check("receipts_status_check", sql`status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])`),
	check("receipts_type_check", sql`type = 'tuition'::text`),
]);

export const receiptAllocations = pgTable("receipt_allocations", {
	id: text().primaryKey().notNull(),
	receiptId: text("receipt_id").notNull(),
	ledgerId: text("ledger_id").notNull(),
	classId: text("class_id").notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	discountType: text("discount_type"),
	discountAmount: numeric("discount_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	discountPercent: numeric("discount_percent", { precision: 5, scale:  2 }),
	discountReason: text("discount_reason"),
	siblingDiscount: boolean("sibling_discount").default(false).notNull(),
	siblingDiscountAmount: numeric("sibling_discount_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	siblingDiscountWaived: boolean("sibling_discount_waived").default(false).notNull(),
	siblingDiscountWaivedReason: text("sibling_discount_waived_reason"),
}, (table) => [
	index("receipt_allocations_ledger_idx").using("btree", table.ledgerId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "receipt_allocations_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "receipt_allocations_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.receiptId],
			foreignColumns: [receipts.id],
			name: "receipt_allocations_receipt_id_fkey"
		}).onDelete("restrict"),
	unique("receipt_allocation_key").on(table.receiptId, table.ledgerId),
	check("receipt_allocations_amount_check", sql`amount >= (0)::numeric`),
	check("receipt_allocations_discount_amount_check", sql`discount_amount >= (0)::numeric`),
	check("receipt_allocations_discount_percent_check", sql`(discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric)`),
	check("receipt_allocations_discount_type_check", sql`discount_type = ANY (ARRAY['none'::text, 'first_prize'::text, 'second_prize'::text, 'full_waiver'::text, 'hardship'::text, 'custom'::text])`),
	check("receipt_allocations_sibling_discount_amount_check", sql`sibling_discount_amount >= (0)::numeric`),
	check("sibling_within_discount", sql`sibling_discount_amount <= discount_amount`),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: text().primaryKey().notNull(),
	schemaVersion: smallint("schema_version").default(2).notNull(),
	transactionGroupId: text("transaction_group_id"),
	groupSequence: smallint("group_sequence"),
	source: text(),
	studentId: text("student_id").notNull(),
	type: text().notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	direction: text(),
	status: text().notNull(),
	receiptId: text("receipt_id"),
	ledgerId: text("ledger_id"),
	expenseId: text("expense_id"),
	classId: text("class_id"),
	note: text().default('').notNull(),
	reason: text(),
	createdBy: text("created_by").notNull(),
	approvedBy: text("approved_by"),
	voidReason: text("void_reason"),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidedBy: text("voided_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	postedAt: timestamp("posted_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_tx_group_idx").using("btree", table.transactionGroupId.asc().nullsLast().op("text_ops")).where(sql`(transaction_group_id IS NOT NULL)`),
	index("wallet_tx_ledger_idx").using("btree", table.ledgerId.asc().nullsLast().op("text_ops")).where(sql`(ledger_id IS NOT NULL)`),
	index("wallet_tx_posted_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops")).where(sql`(status = 'posted'::text)`),
	index("wallet_tx_student_idx").using("btree", table.studentId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "wallet_transactions_approved_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "wallet_transactions_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "wallet_transactions_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.receiptId],
			foreignColumns: [receipts.id],
			name: "wallet_transactions_receipt_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "wallet_transactions_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.voidedBy],
			foreignColumns: [users.id],
			name: "wallet_transactions_voided_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.expenseId],
			foreignColumns: [expenses.id],
			name: "wallet_tx_expense_fkey"
		}).onDelete("restrict"),
	check("wallet_allocation_has_ledger", sql`(type <> 'allocation'::text) OR (ledger_id IS NOT NULL)`),
	check("wallet_direction_scope", sql`((type = 'adjustment'::text) AND (direction IS NOT NULL)) OR ((type <> 'adjustment'::text) AND (direction IS NULL))`),
	check("wallet_posted_has_time", sql`(status <> 'posted'::text) OR (posted_at IS NOT NULL)`),
	check("wallet_transactions_amount_check", sql`amount > (0)::numeric`),
	check("wallet_transactions_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("wallet_transactions_direction_check", sql`direction = ANY (ARRAY['in'::text, 'out'::text])`),
	check("wallet_transactions_group_sequence_check", sql`group_sequence >= 0`),
	check("wallet_transactions_source_check", sql`source = ANY (ARRAY['manual_receipt'::text, 'manual_allocation'::text, 'student_refund'::text])`),
	check("wallet_transactions_status_check", sql`status = ANY (ARRAY['proposed'::text, 'posted'::text, 'rejected'::text, 'void'::text])`),
	check("wallet_transactions_type_check", sql`type = ANY (ARRAY['deposit'::text, 'allocation'::text, 'credit'::text, 'refund'::text, 'adjustment'::text])`),
	check("wallet_void_complete", sql`(status <> 'void'::text) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL))`),
]);

export const invoices = pgTable("invoices", {
	id: text().primaryKey().notNull(),
	invoiceNo: text("invoice_no").notNull(),
	ledgerId: text("ledger_id").notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	parentUid: text("parent_uid"),
	currency: text().default('VND').notNull(),
	status: text().notNull(),
	amountDue: numeric("amount_due", { precision: 14, scale:  2 }).notNull(),
	amountPaid: numeric("amount_paid", { precision: 14, scale:  2 }).default('0').notNull(),
	ledgerAmountSnapshot: numeric("ledger_amount_snapshot", { precision: 14, scale:  2 }).notNull(),
	paidTotalSnapshot: numeric("paid_total_snapshot", { precision: 14, scale:  2 }).notNull(),
	discountTotalSnapshot: numeric("discount_total_snapshot", { precision: 14, scale:  2 }).notNull(),
	studentNameSnapshot: text("student_name_snapshot").notNull(),
	classNameSnapshot: text("class_name_snapshot").notNull(),
	snapshotVersion: integer("snapshot_version").default(1).notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	supersededAt: timestamp("superseded_at", { withTimezone: true, mode: 'string' }),
	supersededByInvoiceId: text("superseded_by_invoice_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("invoices_ledger_idx").using("btree", table.ledgerId.asc().nullsLast().op("text_ops")),
	index("invoices_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.issuedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "invoices_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "invoices_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "invoices_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.supersededByInvoiceId],
			foreignColumns: [table.id],
			name: "invoices_superseded_by_invoice_id_fkey"
		}).onDelete("restrict"),
	unique("invoices_no_key").on(table.invoiceNo),
	check("invoice_superseded_pair", sql`(superseded_at IS NULL) = (superseded_by_invoice_id IS NULL)`),
	check("invoices_amount_due_check", sql`amount_due >= (0)::numeric`),
	check("invoices_amount_paid_check", sql`amount_paid >= (0)::numeric`),
	check("invoices_currency_check", sql`currency = 'VND'::text`),
	check("invoices_status_check", sql`status = ANY (ARRAY['issued'::text, 'partially_paid'::text, 'paid'::text, 'void'::text, 'superseded'::text])`),
]);

export const invoiceLineItems = pgTable("invoice_line_items", {
	id: text().primaryKey().notNull(),
	invoiceId: text("invoice_id").notNull(),
	position: smallint().notNull(),
	type: text().notNull(),
	ledgerId: text("ledger_id").notNull(),
	description: text().notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "invoice_line_items_invoice_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "invoice_line_items_ledger_id_fkey"
		}).onDelete("restrict"),
	unique("invoice_line_position_key").on(table.invoiceId, table.position),
	check("invoice_line_items_amount_check", sql`amount >= (0)::numeric`),
	check("invoice_line_items_position_check", sql`"position" > 0`),
	check("invoice_line_items_type_check", sql`type = 'tuition'::text`),
]);

export const expenses = pgTable("expenses", {
	id: text().primaryKey().notNull(),
	expenseNo: text("expense_no").notNull(),
	type: text(),
	category: text().notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	paidDate: date("paid_date").notNull(),
	payee: text().notNull(),
	purpose: text(),
	note: text(),
	reason: text(),
	studentId: text("student_id"),
	classId: text("class_id"),
	walletTransactionId: text("wallet_transaction_id"),
	status: text().notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("expenses_category_idx").using("btree", table.category.asc().nullsLast().op("date_ops"), table.paidDate.desc().nullsFirst().op("date_ops")),
	index("expenses_paid_date_idx").using("btree", table.paidDate.desc().nullsFirst().op("date_ops")).where(sql`(status = 'posted'::text)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "expenses_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "expenses_created_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "expenses_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.walletTransactionId],
			foreignColumns: [walletTransactions.id],
			name: "expenses_wallet_transaction_id_fkey"
		}).onDelete("restrict"),
	unique("expenses_no_key").on(table.expenseNo),
	check("expense_wallet_refund_shape", sql`(type IS DISTINCT FROM 'wallet_refund'::text) OR ((student_id IS NOT NULL) AND (wallet_transaction_id IS NOT NULL))`),
	check("expenses_amount_check", sql`amount >= (0)::numeric`),
	check("expenses_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("expenses_status_check", sql`status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])`),
	check("expenses_type_check", sql`type = ANY (ARRAY['activity'::text, 'wallet_refund'::text])`),
]);

export const tuitionConfigs = pgTable("tuition_configs", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	teacherId: text("teacher_id").notNull(),
	defaultAmount: numeric("default_amount", { precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	dueDayOfMonth: smallint("due_day_of_month").notNull(),
	autoGenerateMonthly: boolean("auto_generate_monthly").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "tuition_configs_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "tuition_configs_teacher_id_fkey"
		}).onDelete("restrict"),
	unique("tuition_config_class_key").on(table.classId),
	check("tuition_configs_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("tuition_configs_default_amount_check", sql`default_amount >= (0)::numeric`),
	check("tuition_configs_due_day_of_month_check", sql`(due_day_of_month >= 1) AND (due_day_of_month <= 31)`),
]);

export const paymentRequests = pgTable("payment_requests", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	orderCode: bigint("order_code", { mode: "number" }).notNull(),
	provider: text().default('payos').notNull(),
	ledgerId: text("ledger_id").notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	parentUid: text("parent_uid").notNull(),
	invoiceId: text("invoice_id"),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	status: text().notNull(),
	gatewayStatus: text("gateway_status"),
	paymentLinkId: text("payment_link_id"),
	checkoutUrl: text("checkout_url"),
	qrCode: text("qr_code"),
	returnUrl: text("return_url"),
	cancelUrl: text("cancel_url"),
	description: text(),
	receiptId: text("receipt_id"),
	reviewReason: text("review_reason"),
	reviewResolution: text("review_resolution"),
	accountingResolution: text("accounting_resolution"),
	failureReason: text("failure_reason"),
	staleReason: text("stale_reason"),
	gatewayAmount: numeric("gateway_amount", { precision: 14, scale:  2 }),
	gatewayReference: text("gateway_reference"),
	gatewaySnapshot: jsonb("gateway_snapshot"),
	reconciliationCheckedAt: timestamp("reconciliation_checked_at", { withTimezone: true, mode: 'string' }),
	reconciliationError: text("reconciliation_error"),
	invoiceAmountSnapshot: numeric("invoice_amount_snapshot", { precision: 14, scale:  2 }),
	invoiceSnapshotVersion: integer("invoice_snapshot_version"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidedBy: text("voided_by"),
	voidReason: text("void_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payment_requests_ledger_idx").using("btree", table.ledgerId.asc().nullsLast().op("text_ops")),
	index("payment_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "payment_requests_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "payment_requests_invoice_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "payment_requests_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.receiptId],
			foreignColumns: [receipts.id],
			name: "payment_requests_receipt_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "payment_requests_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.voidedBy],
			foreignColumns: [users.id],
			name: "payment_requests_voided_by_fkey"
		}).onDelete("restrict"),
	unique("payment_requests_order_code_key").on(table.orderCode),
	check("payment_requests_accounting_resolution_check", sql`accounting_resolution = ANY (ARRAY['receipt_voided_manual_handling'::text, 'manual_receipt_posted_while_gateway_session_active'::text])`),
	check("payment_requests_amount_check", sql`amount > (0)::numeric`),
	check("payment_requests_currency_check", sql`currency = 'VND'::text`),
	check("payment_requests_provider_check", sql`provider = 'payos'::text`),
	check("payment_requests_review_resolution_check", sql`review_resolution = ANY (ARRAY['approved'::text, 'rejected'::text, 'manual_handling_required'::text])`),
	check("payment_requests_status_check", sql`status = ANY (ARRAY['creating_gateway_session'::text, 'pending'::text, 'paid'::text, 'cancelled'::text, 'expired'::text, 'stale'::text, 'failed'::text, 'create_failed'::text, 'needs_review'::text, 'manually_voided'::text])`),
]);

export const webhookEvents = pgTable("webhook_events", {
	id: text().primaryKey().notNull(),
	provider: text().default('payos').notNull(),
	eventHash: text("event_hash").notNull(),
	signatureValid: boolean("signature_valid").notNull(),
	envelopeCode: text("envelope_code"),
	envelopeDesc: text("envelope_desc"),
	envelopeSuccess: boolean("envelope_success"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	orderCode: bigint("order_code", { mode: "number" }),
	amount: numeric({ precision: 14, scale:  2 }),
	paymentLinkId: text("payment_link_id"),
	providerReference: text("provider_reference"),
	providerCode: text("provider_code"),
	processingStatus: text("processing_status").notNull(),
	processingMessage: text("processing_message"),
	error: text(),
	paymentRequestId: text("payment_request_id"),
	receiptId: text("receipt_id"),
	rawPayload: jsonb("raw_payload"),
	transactionDatetime: timestamp("transaction_datetime", { withTimezone: true, mode: 'string' }),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("webhook_events_order_code_idx").using("btree", table.orderCode.asc().nullsLast().op("int8_ops")).where(sql`(order_code IS NOT NULL)`),
	foreignKey({
			columns: [table.paymentRequestId],
			foreignColumns: [paymentRequests.id],
			name: "webhook_events_payment_request_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.receiptId],
			foreignColumns: [receipts.id],
			name: "webhook_events_receipt_id_fkey"
		}).onDelete("restrict"),
	unique("webhook_events_hash_key").on(table.eventHash),
	check("webhook_events_provider_check", sql`provider = 'payos'::text`),
]);

export const paymentOrderCodes = pgTable("payment_order_codes", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	orderCode: bigint("order_code", { mode: "number" }).primaryKey().notNull(),
	provider: text().default('payos').notNull(),
	status: text().notNull(),
	ledgerId: text("ledger_id"),
	studentId: text("student_id"),
	classId: text("class_id"),
	parentUid: text("parent_uid"),
	paymentRequestId: text("payment_request_id"),
	amount: numeric({ precision: 14, scale:  2 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "payment_order_codes_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "payment_order_codes_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.paymentRequestId],
			foreignColumns: [paymentRequests.id],
			name: "payment_order_codes_payment_request_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "payment_order_codes_student_id_fkey"
		}).onDelete("restrict"),
	check("payment_order_codes_amount_check", sql`amount >= (0)::numeric`),
	check("payment_order_codes_provider_check", sql`provider = 'payos'::text`),
	check("payment_order_codes_status_check", sql`status = ANY (ARRAY['reserved'::text, 'used'::text, 'released'::text])`),
]);

export const financeMonthlyAggregates = pgTable("finance_monthly_aggregates", {
	month: text().primaryKey().notNull(),
	rangeStart: date("range_start").notNull(),
	rangeEnd: date("range_end").notNull(),
	totalIncome: numeric("total_income", { precision: 14, scale:  2 }).default('0').notNull(),
	totalExpenses: numeric("total_expenses", { precision: 14, scale:  2 }).default('0').notNull(),
	incomeByLevel: jsonb("income_by_level").default([]).notNull(),
	expensesByCategory: jsonb("expenses_by_category").default([]).notNull(),
	sourceCounts: jsonb("source_counts").default({}).notNull(),
	schemaVersion: smallint("schema_version").default(1).notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("finance_month_range_order", sql`range_end >= range_start`),
	check("finance_monthly_aggregates_month_check", sql`month ~ '^\d{4}-\d{2}$'::text`),
]);

export const courseClosings = pgTable("course_closings", {
	id: text().primaryKey().notNull(),
	termId: text("term_id").notNull(),
	courseId: text("course_id"),
	termStart: date("term_start").notNull(),
	termEnd: date("term_end"),
	approvalStatus: text("approval_status"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	approvedBy: text("approved_by"),
	approvedByRole: text("approved_by_role"),
	approvalSource: text("approval_source"),
	rosterFingerprint: text("roster_fingerprint"),
	evaluationFingerprint: text("evaluation_fingerprint"),
	invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: 'string' }),
	invalidatedBy: text("invalidated_by"),
	invalidatedReason: text("invalidated_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("course_closings_status_idx").using("btree", table.approvalStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "course_closings_approved_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.invalidatedBy],
			foreignColumns: [users.id],
			name: "course_closings_invalidated_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "course_closings_term_id_fkey"
		}).onDelete("restrict"),
	unique("course_closing_term_key").on(table.termId),
	check("course_closing_approved_complete", sql`(approval_status IS DISTINCT FROM 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_by IS NOT NULL))`),
	check("course_closing_invalidated_complete", sql`(approval_status IS DISTINCT FROM 'invalidated'::text) OR ((invalidated_at IS NOT NULL) AND (invalidated_reason IS NOT NULL))`),
	check("course_closing_term_order", sql`(term_end IS NULL) OR (term_end >= term_start)`),
	check("course_closings_approval_source_check", sql`approval_source = ANY (ARRAY['teacher'::text, 'admin'::text, 'system'::text])`),
	check("course_closings_approval_status_check", sql`approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'invalidated'::text])`),
	check("course_closings_approved_by_role_check", sql`approved_by_role = ANY (ARRAY['teacher'::text, 'admin'::text, 'office'::text])`),
]);

export const refunds = pgTable("refunds", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id"),
	ledgerId: text("ledger_id"),
	expenseId: text("expense_id"),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().default('VND').notNull(),
	status: text().notNull(),
	reason: text(),
	details: jsonb().default({}).notNull(),
	createdBy: text("created_by").notNull(),
	approvedBy: text("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "refunds_approved_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "refunds_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "refunds_created_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.expenseId],
			foreignColumns: [expenses.id],
			name: "refunds_expense_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [courseFeeLedgers.id],
			name: "refunds_ledger_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "refunds_student_id_fkey"
		}).onDelete("restrict"),
	check("refund_approval_pair", sql`(approved_at IS NULL) = (approved_by IS NULL)`),
	check("refunds_amount_check", sql`amount > (0)::numeric`),
	check("refunds_currency_check", sql`currency = ANY (ARRAY['VND'::text, 'USD'::text])`),
	check("refunds_status_check", sql`status = ANY (ARRAY['proposed'::text, 'approved'::text, 'paid'::text, 'rejected'::text, 'void'::text])`),
]);

export const tuitionRecords = pgTable("tuition_records", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	teacherId: text("teacher_id"),
	month: text().notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	paid: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	status: text().notNull(),
	dueDate: date("due_date"),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	paidBy: text("paid_by"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
});

export const financeIdempotencyKeys = pgTable("finance_idempotency_keys", {
	id: text().primaryKey().notNull(),
	uid: text().notNull(),
	idempotencyKey: text("idempotency_key").notNull(),
	type: text().notNull(),
	status: text().notNull(),
	requestFingerprint: text("request_fingerprint"),
	ledgerIds: text("ledger_ids").array().default([""]).notNull(),
	response: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("finance_idempotency_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	unique("finance_idempotency_key_unique").on(table.uid, table.idempotencyKey),
	check("finance_idempotency_keys_status_check", sql`status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text])`),
]);

export const courseClosingExemptions = pgTable("course_closing_exemptions", {
	id: text().primaryKey().notNull(),
	closingId: text("closing_id").notNull(),
	studentId: text("student_id").notNull(),
	reason: text(),
	grantedBy: text("granted_by"),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.closingId],
			foreignColumns: [courseClosings.id],
			name: "course_closing_exemptions_closing_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "course_closing_exemptions_granted_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "course_closing_exemptions_student_id_fkey"
		}).onDelete("restrict"),
	unique("course_closing_exemption_key").on(table.closingId, table.studentId),
]);

export const courseClosingRecords = pgTable("course_closing_records", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	termId: text("term_id"),
	studentId: text("student_id").notNull(),
	teacherId: text("teacher_id").notNull(),
	courseId: text("course_id").notNull(),
	closingMonth: text("closing_month").notNull(),
	courseStartDate: date("course_start_date").notNull(),
	courseEndDate: date("course_end_date").notNull(),
	recordVersion: smallint("record_version").default(1).notNull(),
	studentCodeSnapshot: text("student_code_snapshot").notNull(),
	studentNameSnapshot: text("student_name_snapshot").notNull(),
	classNameSnapshot: text("class_name_snapshot").notNull(),
	teacherNameSnapshot: text("teacher_name_snapshot").notNull(),
	evaluationId: text("evaluation_id"),
	evaluationVersion: text("evaluation_version"),
	evaluationDateSnapshot: date("evaluation_date_snapshot"),
	evaluationClassification: text("evaluation_classification"),
	evaluationFinalScore: smallint("evaluation_final_score"),
	evaluationTotalScore: smallint("evaluation_total_score"),
	evaluationPositivePoints: text("evaluation_positive_points").array().default([""]).notNull(),
	evaluationImprovementPoints: text("evaluation_improvement_points"),
	evaluationScoresSnapshot: jsonb("evaluation_scores_snapshot"),
	evaluationMidtermSnapshot: jsonb("evaluation_midterm_snapshot"),
	tuitionLedgerId: text("tuition_ledger_id"),
	tuitionAmountSnapshot: numeric("tuition_amount_snapshot", { precision: 14, scale:  2 }),
	tuitionNoticeDate: date("tuition_notice_date"),
	nextCourseStartDate: date("next_course_start_date"),
	nextCourseEndDate: date("next_course_end_date"),
	tuitionFinalExamDate: date("tuition_final_exam_date"),
	tuitionFinalExamScore: smallint("tuition_final_exam_score"),
	evaluationAvailabilityStatus: text("evaluation_availability_status"),
	evaluationAvailabilityReason: text("evaluation_availability_reason"),
	evaluationAvailabilityAssessedAt: timestamp("evaluation_availability_assessed_at", { withTimezone: true, mode: 'string' }),
	tuitionAvailabilityStatus: text("tuition_availability_status"),
	tuitionAvailabilityReason: text("tuition_availability_reason"),
	tuitionAvailabilityAssessedAt: timestamp("tuition_availability_assessed_at", { withTimezone: true, mode: 'string' }),
	backfilledAt: timestamp("backfilled_at", { withTimezone: true, mode: 'string' }),
	backfillSourceDigest: text("backfill_source_digest"),
	backfillVersion: smallint("backfill_version"),
	repairSource: text("repair_source"),
	repairedAt: timestamp("repaired_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("closing_records_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.closingMonth.desc().nullsFirst().op("text_ops")),
	index("closing_records_month_idx").using("btree", table.closingMonth.asc().nullsLast().op("text_ops")),
	index("closing_records_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.closingMonth.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "course_closing_records_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "course_closing_records_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "course_closing_records_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "course_closing_records_term_id_fkey"
		}).onDelete("restrict"),
	unique("closing_record_course_student_key").on(table.studentId, table.courseId),
	check("closing_record_date_order", sql`course_end_date >= course_start_date`),
	check("course_closing_records_closing_month_check", sql`closing_month ~ '^\d{4}-\d{2}$'::text`),
	check("course_closing_records_evaluation_availability_status_check", sql`evaluation_availability_status = ANY (ARRAY['verified'::text, 'unavailable'::text])`),
	check("course_closing_records_evaluation_classification_check", sql`evaluation_classification = ANY (ARRAY['excellent'::text, 'good'::text, 'fair'::text, 'failing'::text])`),
	check("course_closing_records_evaluation_final_score_check", sql`(evaluation_final_score >= 0) AND (evaluation_final_score <= 100)`),
	check("course_closing_records_evaluation_total_score_check", sql`(evaluation_total_score >= 0) AND (evaluation_total_score <= 100)`),
	check("course_closing_records_tuition_amount_snapshot_check", sql`tuition_amount_snapshot >= (0)::numeric`),
	check("course_closing_records_tuition_availability_status_check", sql`tuition_availability_status = ANY (ARRAY['verified'::text, 'unavailable'::text])`),
	check("course_closing_records_tuition_final_exam_score_check", sql`(tuition_final_exam_score >= 0) AND (tuition_final_exam_score <= 100)`),
]);

export const courseClosingRecordDocuments = pgTable("course_closing_record_documents", {
	id: text().primaryKey().notNull(),
	recordId: text("record_id").notNull(),
	kind: text().notNull(),
	status: text().notNull(),
	storagePath: text("storage_path"),
	previewStoragePath: text("preview_storage_path"),
	downloadFilename: text("download_filename"),
	mimeType: text("mime_type"),
	templateVersion: smallint("template_version").default(1).notNull(),
	attempts: smallint().default(0).notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	sourceNotificationId: text("source_notification_id"),
}, (table) => [
	foreignKey({
			columns: [table.recordId],
			foreignColumns: [courseClosingRecords.id],
			name: "course_closing_record_documents_record_id_fkey"
		}).onDelete("cascade"),
	unique("closing_document_kind_key").on(table.recordId, table.kind),
	check("closing_document_ready_has_file", sql`(status <> 'ready'::text) OR ((storage_path IS NOT NULL) AND (generated_at IS NOT NULL))`),
	check("course_closing_record_documents_attempts_check", sql`attempts >= 0`),
	check("course_closing_record_documents_kind_check", sql`kind = ANY (ARRAY['evaluation'::text, 'tuition'::text])`),
	check("course_closing_record_documents_status_check", sql`status = ANY (ARRAY['pending'::text, 'generating'::text, 'ready'::text, 'failed'::text])`),
]);

export const teacherAvailabilityProfiles = pgTable("teacher_availability_profiles", {
	id: text().primaryKey().notNull(),
	teacherId: text("teacher_id").notNull(),
	version: integer().default(1).notNull(),
	createdBy: text("created_by").notNull(),
	updatedBy: text("updated_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "teacher_availability_profiles_created_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "teacher_availability_profiles_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "teacher_availability_profiles_updated_by_fkey"
		}).onDelete("restrict"),
	unique("availability_profile_teacher_key").on(table.teacherId),
	check("teacher_availability_profiles_version_check", sql`version > 0`),
]);

export const teacherAvailabilityProfileSelections = pgTable("teacher_availability_profile_selections", {
	id: text().primaryKey().notNull(),
	profileId: text("profile_id").notNull(),
	dayKey: text("day_key").notNull(),
	slotId: text("slot_id").notNull(),
}, (table) => [
	index("availability_selection_slot_idx").using("btree", table.dayKey.asc().nullsLast().op("text_ops"), table.slotId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [teacherAvailabilityProfiles.id],
			name: "teacher_availability_profile_selections_profile_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.slotId],
			foreignColumns: [teacherAvailabilitySlots.slotId],
			name: "teacher_availability_profile_selections_slot_id_fkey"
		}).onDelete("restrict"),
	unique("availability_selection_key").on(table.profileId, table.dayKey, table.slotId),
	check("teacher_availability_profile_selections_day_key_check", sql`day_key = ANY (ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text])`),
]);

export const teacherAvailabilitySlots = pgTable("teacher_availability_slots", {
	slotId: text("slot_id").primaryKey().notNull(),
	label: text().notNull(),
	startTime: time("start_time"),
	endTime: time("end_time"),
	position: smallint().notNull(),
}, (table) => [
	unique("availability_slot_position_key").on(table.position),
	check("availability_slot_time_order", sql`(end_time IS NULL) OR (start_time IS NULL) OR (end_time > start_time)`),
]);

export const teacherAvailabilityChangeRequests = pgTable("teacher_availability_change_requests", {
	id: text().primaryKey().notNull(),
	teacherId: text("teacher_id").notNull(),
	profileId: text("profile_id"),
	status: text().notNull(),
	reason: text(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	reviewedBy: text("reviewed_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("availability_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [teacherAvailabilityProfiles.id],
			name: "teacher_availability_change_requests_profile_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "teacher_availability_change_requests_reviewed_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "teacher_availability_change_requests_teacher_id_fkey"
		}).onDelete("restrict"),
	check("availability_request_review_pair", sql`(reviewed_at IS NULL) = (reviewed_by IS NULL)`),
	check("teacher_availability_change_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])`),
]);

export const teacherAvailabilityChangeRequestSelections = pgTable("teacher_availability_change_request_selections", {
	id: text().primaryKey().notNull(),
	requestId: text("request_id").notNull(),
	dayKey: text("day_key").notNull(),
	slotId: text("slot_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [teacherAvailabilityChangeRequests.id],
			name: "teacher_availability_change_request_selections_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.slotId],
			foreignColumns: [teacherAvailabilitySlots.slotId],
			name: "teacher_availability_change_request_selections_slot_id_fkey"
		}).onDelete("restrict"),
	unique("availability_request_selection_key").on(table.requestId, table.dayKey, table.slotId),
	check("teacher_availability_change_request_selections_day_key_check", sql`day_key = ANY (ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text])`),
]);

export const notifications = pgTable("notifications", {
	id: text().primaryKey().notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id"),
	teacherId: text("teacher_id"),
	type: text().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	isRead: boolean("is_read").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("notifications_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("notifications_unread_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops")).where(sql`(is_read = false)`),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "notifications_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "notifications_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "notifications_teacher_id_fkey"
		}).onDelete("restrict"),
]);

export const adminNotifications = pgTable("admin_notifications", {
	id: text().primaryKey().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	isRead: boolean("is_read").default(false).notNull(),
	countsByType: jsonb("counts_by_type").default({}).notNull(),
	paymentId: text("payment_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	orderCode: bigint("order_code", { mode: "number" }),
	amount: numeric({ precision: 14, scale:  2 }),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admin_notifications_unread_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(is_read = false)`),
	check("admin_notifications_type_check", sql`type = ANY (ARRAY['zalo_failure_digest'::text, 'payment_needs_review'::text, 'payment_failed'::text, 'system_alert'::text])`),
]);

export const adminNotificationFailures = pgTable("admin_notification_failures", {
	id: text().primaryKey().notNull(),
	adminNotificationId: text("admin_notification_id").notNull(),
	zaloNotificationId: text("zalo_notification_id"),
	studentId: text("student_id"),
	phone: text(),
	failureType: text("failure_type").notNull(),
	errorMessage: text("error_message"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("admin_notification_failures_parent_idx").using("btree", table.adminNotificationId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.adminNotificationId],
			foreignColumns: [adminNotifications.id],
			name: "admin_notification_failures_admin_notification_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "admin_notification_failures_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.zaloNotificationId],
			foreignColumns: [zaloNotifications.id],
			name: "admin_notification_failures_zalo_fkey"
		}).onDelete("restrict"),
]);

export const zaloNotifications = pgTable("zalo_notifications", {
	id: text().primaryKey().notNull(),
	zaloMessageId: text("zalo_message_id").notNull(),
	type: text().notNull(),
	status: text().notNull(),
	phone: text().notNull(),
	studentId: text("student_id"),
	classId: text("class_id"),
	termId: text("term_id"),
	teacherId: text("teacher_id"),
	evaluationId: text("evaluation_id"),
	notificationDate: date("notification_date"),
	amount: numeric({ precision: 14, scale:  2 }),
	templateId: text("template_id"),
	recipientRole: text("recipient_role"),
	errorMessage: text("error_message").default('').notNull(),
	providerErrorCode: integer("provider_error_code"),
	providerMessageId: text("provider_message_id"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	sentBy: text("sent_by"),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	resendBy: text("resend_by"),
	payloadSnapshot: jsonb("payload_snapshot"),
	snapshotChecksum: text("snapshot_checksum"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("zalo_notifications_class_idx").using("btree", table.classId.asc().nullsLast().op("date_ops"), table.notificationDate.desc().nullsFirst().op("text_ops")),
	index("zalo_notifications_failed_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(status = 'failed'::text)`),
	index("zalo_notifications_student_idx").using("btree", table.studentId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("zalo_notifications_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "zalo_notifications_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.evaluationId],
			foreignColumns: [evaluations.id],
			name: "zalo_notifications_evaluation_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sentBy],
			foreignColumns: [users.id],
			name: "zalo_notifications_sent_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "zalo_notifications_student_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "zalo_notifications_teacher_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [classTerms.id],
			name: "zalo_notifications_term_id_fkey"
		}).onDelete("restrict"),
	check("zalo_notification_failed_has_error", sql`(status <> 'failed'::text) OR (error_message <> ''::text)`),
	check("zalo_notification_sent_has_time", sql`(status <> 'sent'::text) OR (sent_at IS NOT NULL)`),
	check("zalo_notifications_amount_check", sql`amount >= (0)::numeric`),
	check("zalo_notifications_status_check", sql`status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])`),
]);

export const zaloBotLinks = pgTable("zalo_bot_links", {
	id: text().primaryKey().notNull(),
	staffId: text("staff_id").notNull(),
	chatId: text("chat_id").notNull(),
	chatIdHash: text("chat_id_hash").notNull(),
	role: text().notNull(),
	displayName: text("display_name"),
	status: text().notNull(),
	confirmationStatus: text("confirmation_status"),
	linkedMethod: text("linked_method"),
	linkedBy: text("linked_by"),
	linkedAt: timestamp("linked_at", { withTimezone: true, mode: 'string' }).notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.linkedBy],
			foreignColumns: [users.id],
			name: "zalo_bot_links_linked_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [users.id],
			name: "zalo_bot_links_staff_id_fkey"
		}).onDelete("restrict"),
	unique("zalo_bot_link_staff_key").on(table.staffId),
	unique("zalo_bot_link_chat_key").on(table.chatIdHash),
	check("zalo_bot_links_confirmation_status_check", sql`confirmation_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text])`),
	check("zalo_bot_links_linked_method_check", sql`linked_method = ANY (ARRAY['self'::text, 'admin'::text])`),
	check("zalo_bot_links_role_check", sql`role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
	check("zalo_bot_links_status_check", sql`status = ANY (ARRAY['active'::text, 'revoked'::text])`),
]);

export const zaloBotLinkCodes = pgTable("zalo_bot_link_codes", {
	id: text().primaryKey().notNull(),
	staffId: text("staff_id").notNull(),
	role: text().notNull(),
	displayName: text("display_name"),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	consumedByChatIdHash: text("consumed_by_chat_id_hash"),
}, (table) => [
	index("zalo_bot_link_codes_live_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(consumed_at IS NULL)`),
	index("zalo_bot_link_codes_staff_idx").using("btree", table.staffId.asc().nullsLast().op("text_ops"), table.issuedAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [users.id],
			name: "zalo_bot_link_codes_staff_id_fkey"
		}).onDelete("restrict"),
	check("link_code_consumed_pair", sql`(consumed_at IS NULL) = (consumed_by_chat_id_hash IS NULL)`),
	check("link_code_expiry_after_issue", sql`expires_at > issued_at`),
	check("zalo_bot_link_codes_role_check", sql`role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
]);

export const zaloBotChatClaims = pgTable("zalo_bot_chat_claims", {
	id: text().primaryKey().notNull(),
	staffId: text("staff_id").notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }).notNull(),
	released: boolean().default(false).notNull(),
	releasedAt: timestamp("released_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [users.id],
			name: "zalo_bot_chat_claims_staff_id_fkey"
		}).onDelete("restrict"),
	check("chat_claim_release_pair", sql`(released = false) = (released_at IS NULL)`),
]);

export const zaloBotChatSessions = pgTable("zalo_bot_chat_sessions", {
	staffId: text("staff_id").primaryKey().notNull(),
	lastIntent: text("last_intent"),
	lastClassId: text("last_class_id"),
	lastAskedAt: timestamp("last_asked_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.lastClassId],
			foreignColumns: [classes.id],
			name: "zalo_bot_chat_sessions_last_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [users.id],
			name: "zalo_bot_chat_sessions_staff_id_fkey"
		}).onDelete("cascade"),
	check("chat_session_expiry_after_ask", sql`expires_at > last_asked_at`),
]);

export const zaloBotMessages = pgTable("zalo_bot_messages", {
	id: text().primaryKey().notNull(),
	staffId: text("staff_id").notNull(),
	chatIdHash: text("chat_id_hash").notNull(),
	role: text().notNull(),
	messageType: text("message_type").notNull(),
	digestDate: date("digest_date").notNull(),
	status: text().notNull(),
	contentSnapshot: text("content_snapshot"),
	providerMessageId: text("provider_message_id"),
	attempts: smallint().default(0).notNull(),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("zalo_bot_daily_digest_key").using("btree", table.staffId.asc().nullsLast().op("date_ops"), table.digestDate.asc().nullsLast().op("date_ops"), table.messageType.asc().nullsLast().op("text_ops")).where(sql`(message_type = 'daily_digest'::text)`),
	index("zalo_bot_messages_staff_idx").using("btree", table.staffId.asc().nullsLast().op("date_ops"), table.digestDate.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [users.id],
			name: "zalo_bot_messages_staff_id_fkey"
		}).onDelete("restrict"),
	check("zalo_bot_messages_attempts_check", sql`attempts >= 0`),
	check("zalo_bot_messages_message_type_check", sql`message_type = ANY (ARRAY['daily_digest'::text, 'chat_reply'::text, 'link_confirmation'::text])`),
	check("zalo_bot_messages_role_check", sql`role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])`),
	check("zalo_bot_messages_status_check", sql`status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])`),
]);

export const zaloBulkJobs = pgTable("zalo_bulk_jobs", {
	id: text().primaryKey().notNull(),
	classId: text("class_id").notNull(),
	courseId: text("course_id"),
	type: text().notNull(),
	status: text().notNull(),
	requestedCount: integer("requested_count").notNull(),
	validCount: integer("valid_count").default(0).notNull(),
	successCount: integer("success_count").default(0).notNull(),
	failureCount: integer("failure_count").default(0).notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("zalo_bulk_jobs_class_idx").using("btree", table.classId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "zalo_bulk_jobs_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "zalo_bulk_jobs_created_by_fkey"
		}).onDelete("restrict"),
	check("bulk_job_counts_add_up", sql`(success_count + failure_count) <= valid_count`),
	check("bulk_job_valid_within_requested", sql`valid_count <= requested_count`),
	check("zalo_bulk_jobs_failure_count_check", sql`failure_count >= 0`),
	check("zalo_bulk_jobs_requested_count_check", sql`requested_count >= 0`),
	check("zalo_bulk_jobs_status_check", sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'partial_failure'::text, 'failed'::text])`),
	check("zalo_bulk_jobs_success_count_check", sql`success_count >= 0`),
	check("zalo_bulk_jobs_type_check", sql`type = ANY (ARRAY['evaluation'::text, 'rank_achievement'::text, 'tuition_notice'::text])`),
	check("zalo_bulk_jobs_valid_count_check", sql`valid_count >= 0`),
]);

export const zaloBulkJobItems = pgTable("zalo_bulk_job_items", {
	id: text().primaryKey().notNull(),
	jobId: text("job_id").notNull(),
	studentId: text("student_id").notNull(),
	classId: text("class_id").notNull(),
	courseId: text("course_id"),
	type: text().notNull(),
	status: text().notNull(),
	messageId: text("message_id"),
	error: text().default('').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("zalo_bulk_job_items_job_idx").using("btree", table.jobId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "zalo_bulk_job_items_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [zaloBulkJobs.id],
			name: "zalo_bulk_job_items_job_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [zaloNotifications.id],
			name: "zalo_bulk_job_items_message_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [students.id],
			name: "zalo_bulk_job_items_student_id_fkey"
		}).onDelete("restrict"),
	unique("bulk_job_item_key").on(table.jobId, table.studentId),
	check("zalo_bulk_job_items_status_check", sql`status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])`),
	check("zalo_bulk_job_items_type_check", sql`type = ANY (ARRAY['evaluation'::text, 'rank_achievement'::text, 'tuition_notice'::text])`),
]);

export const auditLogs = pgTable("audit_logs", {
	id: text().primaryKey().notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	userId: text("user_id").notNull(),
	userRole: text("user_role").notNull(),
	action: text().notNull(),
	entityTable: text("entity_table").notNull(),
	entityId: text("entity_id").notNull(),
	ip: inet(),
	userAgent: text("user_agent"),
	changes: jsonb(),
	metadata: jsonb(),
	userName: text("user_name"),
}, (table) => [
	index("audit_logs_action_idx").using("btree", table.action.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("audit_logs_entity_idx").using("btree", table.entityTable.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_occurred_brin").using("brin", table.occurredAt.asc().nullsLast().op("timestamptz_minmax_ops")),
	index("audit_logs_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const zaloConfig = pgTable("zalo_config", {
	id: text().default('tokens').primaryKey().notNull(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("zalo_config_id_check", sql`id = 'tokens'::text`),
]);

export const jobs = pgTable("jobs", {
	id: text().primaryKey().notNull(),
	kind: text().notNull(),
	name: text().notNull(),
	status: text().notNull(),
	params: jsonb().default({}).notNull(),
	result: jsonb().default({}).notNull(),
	error: jsonb(),
	attempts: smallint().default(0).notNull(),
	requestedById: text("requested_by_id"),
	requestedByRole: text("requested_by_role"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	durationMs: integer("duration_ms"),
	schemaVersion: smallint("schema_version").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("jobs_kind_idx").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("jobs_running_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['queued'::text, 'running'::text]))`),
	foreignKey({
			columns: [table.requestedById],
			foreignColumns: [users.id],
			name: "jobs_requested_by_id_fkey"
		}).onDelete("restrict"),
	check("job_completion_order", sql`(completed_at IS NULL) OR (started_at IS NULL) OR (completed_at >= started_at)`),
	check("jobs_attempts_check", sql`attempts >= 0`),
	check("jobs_duration_ms_check", sql`duration_ms >= 0`),
	check("jobs_status_check", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])`),
]);

export const printRequests = pgTable("print_requests", {
	id: text().primaryKey().notNull(),
	teacherId: text("teacher_id").notNull(),
	classId: text("class_id"),
	title: text().notNull(),
	note: text(),
	copies: smallint().default(1).notNull(),
	neededBy: date("needed_by"),
	status: text().notNull(),
	handledBy: text("handled_by"),
	handledAt: timestamp("handled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("print_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.classId],
			foreignColumns: [classes.id],
			name: "print_requests_class_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.handledBy],
			foreignColumns: [users.id],
			name: "print_requests_handled_by_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [users.id],
			name: "print_requests_teacher_id_fkey"
		}).onDelete("restrict"),
	check("print_request_handled_pair", sql`(handled_at IS NULL) = (handled_by IS NULL)`),
	check("print_requests_copies_check", sql`copies > 0`),
	check("print_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'printed'::text, 'rejected'::text, 'cancelled'::text])`),
]);

export const printRequestFiles = pgTable("print_request_files", {
	id: text().primaryKey().notNull(),
	printRequestId: text("print_request_id").notNull(),
	position: smallint().notNull(),
	storagePath: text("storage_path").notNull(),
	originalFilename: text("original_filename").notNull(),
	mimeType: text("mime_type"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSize: bigint("file_size", { mode: "number" }),
}, (table) => [
	foreignKey({
			columns: [table.printRequestId],
			foreignColumns: [printRequests.id],
			name: "print_request_files_print_request_id_fkey"
		}).onDelete("cascade"),
	unique("print_request_file_position_key").on(table.printRequestId, table.position),
	check("print_request_files_file_size_check", sql`file_size >= 0`),
	check("print_request_files_position_check", sql`"position" > 0`),
]);

export const studentEnrollmentMigrationJournal = pgTable("student_enrollment_migration_journal", {
	id: text().primaryKey().notNull(),
	migrationId: text("migration_id").notNull(),
	runId: text("run_id").notNull(),
	studentId: text("student_id").notNull(),
	documentId: text("document_id").notNull(),
	digest: text().notNull(),
	payloadFingerprint: text("payload_fingerprint").notNull(),
	targetProjectId: text("target_project_id").notNull(),
	targetDatabaseId: text("target_database_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("enrollment_journal_run_idx").using("btree", table.runId.asc().nullsLast().op("text_ops")),
]);

export const outboxJobs = pgTable("outbox_jobs", {
	id: text().primaryKey().notNull(),
	type: text().notNull(),
	idempotencyKey: text("idempotency_key").notNull(),
	status: text().notNull(),
	payload: jsonb().default({}).notNull(),
	attempts: smallint().default(0).notNull(),
	maxAttempts: smallint("max_attempts").default(3).notNull(),
	nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: 'string' }).notNull(),
	lockedBy: text("locked_by"),
	processingStartedAt: timestamp("processing_started_at", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("outbox_jobs_ready_idx").using("btree", table.nextRunAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['pending'::text, 'failed'::text]))`),
	unique("outbox_idempotency_key_unique").on(table.idempotencyKey),
	check("outbox_jobs_attempts_check", sql`attempts >= 0`),
	check("outbox_jobs_max_attempts_check", sql`max_attempts > 0`),
	check("outbox_jobs_status_check", sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'dead'::text])`),
	check("outbox_lock_pair", sql`(locked_by IS NULL) = (processing_started_at IS NULL)`),
]);

export const jobRuns = pgTable("job_runs", {
	jobName: text("job_name").primaryKey().notNull(),
	status: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	checked: integer().default(0).notNull(),
	changed: integer().default(0).notNull(),
	cursor: text(),
	errorCode: text("error_code").default('').notNull(),
	errorMessage: text("error_message").default('').notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("job_run_finished_unless_running", sql`(status = 'running'::text) OR (finished_at IS NOT NULL)`),
	check("job_run_order", sql`(finished_at IS NULL) OR (finished_at >= started_at)`),
	check("job_runs_changed_check", sql`changed >= 0`),
	check("job_runs_checked_check", sql`checked >= 0`),
	check("job_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])`),
]);
export const allowedTeachers = pgView("allowed_teachers", {	email: text(),
	role: text(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }),
	addedByAdmin: boolean("added_by_admin"),
}).as(sql`SELECT email, role, added_at, added_by_admin FROM staff_email_access WHERE status = 'allowed'::text`);

export const blockedTeachers = pgView("blocked_teachers", {	email: text(),
	blockedAt: timestamp("blocked_at", { withTimezone: true, mode: 'string' }),
	blockedBy: text("blocked_by"),
}).as(sql`SELECT email, blocked_at, blocked_by FROM staff_email_access WHERE status = 'blocked'::text`);

export const vClassCurrentTerm = pgView("v_class_current_term", {	classId: text("class_id"),
	termId: text("term_id"),
	courseId: text("course_id"),
	termName: text("term_name"),
	termStart: date("term_start"),
	termEnd: date("term_end"),
	tuitionFee: numeric("tuition_fee", { precision: 14, scale:  2 }),
	currency: text(),
	startTime: time("start_time"),
	daysOfWeek: smallint("days_of_week"),
	isOpen: boolean("is_open"),
}).as(sql`SELECT DISTINCT ON (class_id) class_id, id AS term_id, course_id, name AS term_name, term_start, term_end, tuition_fee, currency, start_time, days_of_week, term_end IS NULL OR term_end >= CURRENT_DATE AS is_open FROM class_terms t ORDER BY class_id, term_start DESC`);

export const vClassTermStudentCounts = pgView("v_class_term_student_counts", {	classId: text("class_id"),
	termStart: date("term_start"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	total: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	active: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	trial: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	onLeave: bigint("on_leave", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dropped: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completed: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	promoted: bigint({ mode: "number" }),
}).as(sql`SELECT class_id, term_start, count(*) AS total, count(*) FILTER (WHERE status = 'active'::text) AS active, count(*) FILTER (WHERE status = 'trial'::text) AS trial, count(*) FILTER (WHERE status = 'on_leave'::text) AS on_leave, count(*) FILTER (WHERE status = 'dropped'::text) AS dropped, count(*) FILTER (WHERE status = 'completed'::text) AS completed, count(*) FILTER (WHERE status = 'transferred'::text) AS promoted FROM student_course_enrollments e GROUP BY class_id, term_start`);

export const vClassStudentCounts = pgView("v_class_student_counts", {	classId: text("class_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	total: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	active: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	trial: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	onLeave: bigint("on_leave", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dropped: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completed: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	promoted: bigint({ mode: "number" }),
}).as(sql`SELECT c.id AS class_id, COALESCE(n.total, 0::bigint) AS total, COALESCE(n.active, 0::bigint) AS active, COALESCE(n.trial, 0::bigint) AS trial, COALESCE(n.on_leave, 0::bigint) AS on_leave, COALESCE(n.dropped, 0::bigint) AS dropped, COALESCE(n.completed, 0::bigint) AS completed, COALESCE(n.promoted, 0::bigint) AS promoted FROM classes c LEFT JOIN v_class_current_term ct ON ct.class_id = c.id LEFT JOIN v_class_term_student_counts n ON n.class_id = c.id AND n.term_start = ct.term_start`);

export const vLedgerTotals = pgView("v_ledger_totals", {	ledgerId: text("ledger_id"),
	paidTotal: numeric("paid_total"),
	discountTotal: numeric("discount_total"),
	siblingDiscountTotal: numeric("sibling_discount_total"),
	outstanding: numeric(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	allocationCount: bigint("allocation_count", { mode: "number" }),
}).as(sql`SELECT l.id AS ledger_id, COALESCE(sum(a.amount), 0::numeric) AS paid_total, COALESCE(sum(a.discount_amount), 0::numeric) AS discount_total, COALESCE(sum(a.sibling_discount_amount), 0::numeric) AS sibling_discount_total, l.amount - COALESCE(sum(a.amount), 0::numeric) - COALESCE(sum(a.discount_amount), 0::numeric) AS outstanding, count(a.id) AS allocation_count FROM course_fee_ledgers l LEFT JOIN receipt_allocations a ON a.ledger_id = l.id LEFT JOIN receipts r ON r.id = a.receipt_id AND r.status = 'posted'::text WHERE a.id IS NULL OR r.id IS NOT NULL GROUP BY l.id, l.amount`);

export const vStudentWalletBalance = pgView("v_student_wallet_balance", {	studentId: text("student_id"),
	balance: numeric(),
	openingBalance: numeric("opening_balance"),
	historyStartedAt: date("history_started_at"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	postedTransactionCount: bigint("posted_transaction_count", { mode: "number" }),
}).as(sql`SELECT s.id AS student_id, COALESCE(w.opening_balance, 0::numeric) + COALESCE(sum( CASE t.type WHEN 'deposit'::text THEN t.amount WHEN 'credit'::text THEN t.amount WHEN 'allocation'::text THEN - t.amount WHEN 'refund'::text THEN - t.amount WHEN 'adjustment'::text THEN CASE WHEN t.direction = 'out'::text THEN - t.amount ELSE t.amount END ELSE NULL::numeric END), 0::numeric) AS balance, COALESCE(w.opening_balance, 0::numeric) AS opening_balance, w.history_started_at, count(t.id) AS posted_transaction_count FROM students s LEFT JOIN student_wallets w ON w.student_id = s.id LEFT JOIN wallet_transactions t ON t.student_id = s.id AND t.status = 'posted'::text GROUP BY s.id, w.opening_balance, w.history_started_at`);

export const vStudentCurrentEnrollment = pgView("v_student_current_enrollment", {	studentId: text("student_id"),
	enrollmentId: text("enrollment_id"),
	classId: text("class_id"),
	teacherId: text("teacher_id"),
	termStart: date("term_start"),
	termEnd: date("term_end"),
	status: text(),
	joinedAt: date("joined_at"),
}).as(sql`SELECT e.student_id, e.id AS enrollment_id, e.class_id, c.teacher_id, e.term_start, e.term_end, e.status, e.joined_at FROM student_course_enrollments e JOIN classes c ON c.id = e.class_id WHERE e.status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text])`);

export const mvAccountingStudentSummary = pgMaterializedView("mv_accounting_student_summary", {	studentId: text("student_id"),
	studentCode: text("student_code"),
	studentName: text("student_name"),
	studentNameNormalized: text("student_name_normalized"),
	studentLifecycle: text("student_lifecycle"),
	currentClassId: text("current_class_id"),
	currentEnrollmentId: text("current_enrollment_id"),
	currentEnrollmentStatus: text("current_enrollment_status"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	classCount: bigint("class_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	courseCount: bigint("course_count", { mode: "number" }),
	totalPaid: numeric("total_paid"),
	totalOutstanding: numeric("total_outstanding"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	overdueCourseCount: bigint("overdue_course_count", { mode: "number" }),
	walletBalance: numeric("wallet_balance"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tuitionReminderCount: bigint("tuition_reminder_count", { mode: "number" }),
	lastReminderAt: timestamp("last_reminder_at", { withTimezone: true, mode: 'string' }),
	rebuiltAt: timestamp("rebuilt_at", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT s.id AS student_id, s.code AS student_code, s.name AS student_name, s.name_normalized AS student_name_normalized, s.student_lifecycle, cur.class_id AS current_class_id, cur.enrollment_id AS current_enrollment_id, cur.status AS current_enrollment_status, COALESCE(agg.class_count, 0::bigint) AS class_count, COALESCE(agg.course_count, 0::bigint) AS course_count, COALESCE(agg.total_paid, 0::numeric) AS total_paid, COALESCE(agg.total_outstanding, 0::numeric) AS total_outstanding, COALESCE(agg.overdue_course_count, 0::bigint) AS overdue_course_count, COALESCE(wb.balance, 0::numeric) AS wallet_balance, COALESCE(nl.reminder_count, 0::bigint) AS tuition_reminder_count, nl.last_reminder_at, now() AS rebuilt_at FROM students s LEFT JOIN LATERAL ( SELECT e.class_id, e.id AS enrollment_id, e.status FROM student_course_enrollments e WHERE e.student_id = s.id AND (e.status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text])) ORDER BY e.term_start DESC LIMIT 1) cur ON true LEFT JOIN LATERAL ( SELECT count(DISTINCT l.class_id) AS class_count, count(*) AS course_count, sum(vt.paid_total) AS total_paid, sum(GREATEST(vt.outstanding, 0::numeric)) AS total_outstanding, count(*) FILTER (WHERE (l.status = ANY (ARRAY['unpaid'::text, 'partial'::text])) AND l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE) AS overdue_course_count FROM course_fee_ledgers l JOIN v_ledger_totals vt ON vt.ledger_id = l.id WHERE l.student_id = s.id) agg ON true LEFT JOIN v_student_wallet_balance wb ON wb.student_id = s.id LEFT JOIN LATERAL ( SELECT count(*) AS reminder_count, max(n.sent_at) AS last_reminder_at FROM ledger_notice_log n JOIN course_fee_ledgers l2 ON l2.id = n.ledger_id WHERE l2.student_id = s.id) nl ON true`);

export const mvAdminClassTuitionSummary = pgMaterializedView("mv_admin_class_tuition_summary", {	classId: text("class_id"),
	termStart: date("term_start"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	ledgerCount: bigint("ledger_count", { mode: "number" }),
	totalAmount: numeric("total_amount"),
	totalPaid: numeric("total_paid"),
	totalDiscount: numeric("total_discount"),
	totalOutstanding: numeric("total_outstanding"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	paidCount: bigint("paid_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	partialCount: bigint("partial_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	unpaidCount: bigint("unpaid_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	waivedCount: bigint("waived_count", { mode: "number" }),
	rebuiltAt: timestamp("rebuilt_at", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT l.class_id, l.term_start, count(*) AS ledger_count, sum(l.amount) AS total_amount, sum(vt.paid_total) AS total_paid, sum(vt.discount_total) AS total_discount, sum(GREATEST(vt.outstanding, 0::numeric)) AS total_outstanding, count(*) FILTER (WHERE l.status = 'paid'::text) AS paid_count, count(*) FILTER (WHERE l.status = 'partial'::text) AS partial_count, count(*) FILTER (WHERE l.status = 'unpaid'::text) AS unpaid_count, count(*) FILTER (WHERE l.status = 'waived'::text) AS waived_count, now() AS rebuilt_at FROM course_fee_ledgers l JOIN v_ledger_totals vt ON vt.ledger_id = l.id WHERE l.term_start IS NOT NULL GROUP BY l.class_id, l.term_start`);
