-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SEQUENCE "public"."receipt_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "student_auth_credentials" (
	"student_id" text PRIMARY KEY NOT NULL,
	"student_password_hash" text,
	"student_password_salt" text,
	"student_password_version" smallint,
	"student_force_password_change" boolean DEFAULT false NOT NULL,
	"parent_password_hash" text,
	"parent_password_salt" text,
	"parent_password_version" smallint,
	"parent_force_password_change" boolean DEFAULT false NOT NULL,
	"migrated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_secret_complete" CHECK (num_nulls(parent_password_hash, parent_password_salt) = ANY (ARRAY[0, 2])),
	CONSTRAINT "student_auth_credentials_parent_password_version_check" CHECK (parent_password_version = ANY (ARRAY[1, 2])),
	CONSTRAINT "student_auth_credentials_student_password_version_check" CHECK (student_password_version = ANY (ARRAY[1, 2])),
	CONSTRAINT "student_secret_complete" CHECK (num_nulls(student_password_hash, student_password_salt) = ANY (ARRAY[0, 2]))
);
--> statement-breakpoint
CREATE TABLE "staff_email_access" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"role" text,
	"added_at" timestamp with time zone,
	"added_by_admin" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_needs_role" CHECK ((status = 'blocked'::text) OR (role IS NOT NULL)),
	CONSTRAINT "blocked_needs_time" CHECK ((status = 'allowed'::text) OR (blocked_at IS NOT NULL)),
	CONSTRAINT "email_is_lowercase" CHECK (email = lower(btrim(email))),
	CONSTRAINT "staff_email_access_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])),
	CONSTRAINT "staff_email_access_status_check" CHECK (status = ANY (ARRAY['allowed'::text, 'blocked'::text]))
);
--> statement-breakpoint
CREATE TABLE "staff_account_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_account_requests_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])),
	CONSTRAINT "staff_account_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
	CONSTRAINT "staff_request_review_pair" CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
--> statement-breakpoint
CREATE TABLE "password_reset_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"scope" text DEFAULT 'student' NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_requests_scope_check" CHECK (scope = ANY (ARRAY['student'::text, 'parent'::text])),
	CONSTRAINT "password_reset_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text])),
	CONSTRAINT "password_reset_resolution_pair" CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);
--> statement-breakpoint
CREATE TABLE "staff_password_reset_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_password_reset_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text]))
);
--> statement-breakpoint
CREATE TABLE "teacher_registration_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"phone" text,
	"status" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_registration_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))
);
--> statement-breakpoint
CREATE TABLE "admissions_history" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text,
	"teacher_id" text,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_history_action_check" CHECK (action = ANY (ARRAY['added_to_waitlist'::text, 'class_changed'::text, 'admitted'::text, 'rejected'::text]))
);
--> statement-breakpoint
CREATE TABLE "student_progression_events" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"from_class_id" text,
	"to_class_id" text,
	"event_type" text NOT NULL,
	"operation_id" text,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"filename" text PRIMARY KEY NOT NULL,
	"checksum" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "schema_migrations_status_check" CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"ran_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_term_weekly_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"term_id" text NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	CONSTRAINT "weekly_session_slot_key" UNIQUE("term_id","day_of_week","start_time"),
	CONSTRAINT "class_term_weekly_sessions_day_of_week_check" CHECK ((day_of_week >= 0) AND (day_of_week <= 6)),
	CONSTRAINT "weekly_session_time_order" CHECK (end_time > start_time)
);
--> statement-breakpoint
CREATE TABLE "class_holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"term_id" text NOT NULL,
	"holiday_date" date NOT NULL,
	"note" text,
	CONSTRAINT "class_holiday_key" UNIQUE("term_id","holiday_date")
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"term_id" text,
	"session_date" date NOT NULL,
	"teacher_id" text NOT NULL,
	"status" text DEFAULT 'taught' NOT NULL,
	"salary_per_session" numeric(14, 2) DEFAULT '0' NOT NULL,
	"teacher_attendance_status" text,
	"teacher_attendance_marked_at" timestamp with time zone,
	"teacher_attendance_marked_by" text,
	"teacher_attendance_marked_by_role" text,
	"teacher_attendance_note" text,
	"teacher_attendance_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_date_key" UNIQUE("class_id","session_date"),
	CONSTRAINT "class_sessions_salary_per_session_check" CHECK (salary_per_session >= (0)::numeric),
	CONSTRAINT "class_sessions_status_check" CHECK (status = ANY (ARRAY['taught'::text, 'cancelled'::text, 'holiday'::text])),
	CONSTRAINT "class_sessions_teacher_attendance_marked_by_role_check" CHECK (teacher_attendance_marked_by_role = ANY (ARRAY['admin'::text, 'office'::text])),
	CONSTRAINT "class_sessions_teacher_attendance_source_check" CHECK (teacher_attendance_source = ANY (ARRAY['office_admin'::text, 'promotion_backfill'::text])),
	CONSTRAINT "class_sessions_teacher_attendance_status_check" CHECK (teacher_attendance_status = ANY (ARRAY['present'::text, 'absent'::text, 'substituted'::text])),
	CONSTRAINT "teacher_attendance_complete" CHECK ((teacher_attendance_status IS NULL) OR ((teacher_attendance_marked_at IS NOT NULL) AND (teacher_attendance_marked_by IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"room" text DEFAULT '' NOT NULL,
	"teacher_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"grade" smallint,
	"salary_per_session" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"import_source_class_id" text,
	"promoted_at" timestamp with time zone,
	"promotion_source_class_name" text,
	"promotion_source_teacher_name" text,
	"promotion_note" text,
	"promotion_recorded_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" text,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_archive_pair" CHECK ((status = 'archived'::text) OR ((archived_at IS NULL) AND (archived_by IS NULL))),
	CONSTRAINT "classes_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "classes_grade_check" CHECK ((grade >= 1) AND (grade <= 12)),
	CONSTRAINT "classes_salary_per_session_check" CHECK (salary_per_session >= (0)::numeric),
	CONSTRAINT "classes_status_check" CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text]))
);
--> statement-breakpoint
CREATE TABLE "class_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"course_id" text,
	"name" text,
	"term_start" date NOT NULL,
	"term_end" date,
	"tuition_fee" numeric(14, 2),
	"currency" text DEFAULT 'VND' NOT NULL,
	"start_time" time,
	"days_of_week" smallint[] DEFAULT '{}' NOT NULL,
	"reset_operation_id" text,
	"repair_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_terms_class_start_key" UNIQUE("class_id","term_start"),
	CONSTRAINT "class_terms_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "class_terms_days_valid" CHECK (days_of_week <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]),
	CONSTRAINT "class_terms_order" CHECK ((term_end IS NULL) OR (term_end >= term_start)),
	CONSTRAINT "class_terms_tuition_fee_check" CHECK (tuition_fee >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"code_normalized" text GENERATED ALWAYS AS (app_normalize_code(code)) STORED,
	"name" text NOT NULL,
	"name_normalized" text GENERATED ALWAYS AS (app_normalize_text(name)) STORED,
	"dob" date,
	"contact" text,
	"gender" text,
	"grade" smallint,
	"student_lifecycle" text DEFAULT 'enrolled' NOT NULL,
	"admission_status" text,
	"admitted_at" timestamp with time zone,
	"admitted_by" text,
	"enrollment_date" date,
	"trial_class_id" text,
	"trial_teacher_id" text,
	"trial_started_at" timestamp with time zone,
	"trial_session_count" integer DEFAULT 0 NOT NULL,
	"trial_required_sessions" integer,
	"trial_review_status" text,
	"face_image_storage_path" text,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_admission_status_check" CHECK (admission_status = ANY (ARRAY['pending'::text, 'trial'::text, 'accepted'::text, 'rejected'::text])),
	CONSTRAINT "students_admitted_pair" CHECK ((admitted_at IS NULL) = (admitted_by IS NULL)),
	CONSTRAINT "students_code_shape" CHECK (btrim(code) <> ''::text),
	CONSTRAINT "students_gender_check" CHECK (gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])),
	CONSTRAINT "students_grade_check" CHECK ((grade >= 1) AND (grade <= 12)),
	CONSTRAINT "students_student_lifecycle_check" CHECK (student_lifecycle = ANY (ARRAY['pending'::text, 'lead'::text, 'trial'::text, 'enrolled'::text, 'archived'::text])),
	CONSTRAINT "students_trial_pair" CHECK ((trial_class_id IS NULL) OR (trial_started_at IS NOT NULL)),
	CONSTRAINT "students_trial_required_sessions_check" CHECK (trial_required_sessions > 0),
	CONSTRAINT "students_trial_review_status_check" CHECK (trial_review_status = ANY (ARRAY['pending_sessions'::text, 'pending_teacher_review'::text, 'accepted'::text, 'rejected'::text])),
	CONSTRAINT "students_trial_session_count_check" CHECK (trial_session_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"bio" text,
	"role" text NOT NULL,
	"phone" text,
	"student_id" text,
	"force_password_change" boolean DEFAULT false NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'student'::text, 'parent'::text, 'admin'::text, 'accounting'::text, 'office'::text])),
	CONSTRAINT "users_student_link" CHECK ((role <> ALL (ARRAY['student'::text, 'parent'::text])) OR (student_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "student_course_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"term_id" text,
	"term_start" date NOT NULL,
	"term_end" date,
	"status" text NOT NULL,
	"joined_at" date NOT NULL,
	"ended_at" date,
	"status_reason" text,
	"source" text NOT NULL,
	"confidence" text NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"status_changed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_term_key" UNIQUE("student_id","class_id","term_start"),
	CONSTRAINT "enrollment_confirm_pair" CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
	CONSTRAINT "enrollment_joined_in_term" CHECK ((joined_at >= term_start) AND ((term_end IS NULL) OR (joined_at <= term_end))),
	CONSTRAINT "enrollment_open_has_no_end" CHECK (((status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text])) AND (ended_at IS NULL)) OR ((status = ANY (ARRAY['completed'::text, 'transferred'::text, 'dropped'::text])) AND (ended_at IS NOT NULL) AND (ended_at >= joined_at))),
	CONSTRAINT "enrollment_term_order" CHECK ((term_end IS NULL) OR (term_end >= term_start)),
	CONSTRAINT "student_course_enrollments_confidence_check" CHECK (confidence = ANY (ARRAY['confirmed'::text, 'inferred'::text])),
	CONSTRAINT "student_course_enrollments_source_check" CHECK (source = ANY (ARRAY['system'::text, 'backfill'::text, 'manual'::text])),
	CONSTRAINT "student_course_enrollments_status_check" CHECK (status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text, 'completed'::text, 'transferred'::text, 'dropped'::text]))
);
--> statement-breakpoint
CREATE TABLE "student_leave_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text,
	"leave_from" date NOT NULL,
	"leave_until" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_period_order" CHECK ((leave_until IS NULL) OR (leave_until >= leave_from))
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"enrollment_id" text,
	"session_id" text,
	"attendance_date" date NOT NULL,
	"status" text NOT NULL,
	"teacher_id" text NOT NULL,
	"permission" boolean DEFAULT false NOT NULL,
	"minutes_late" integer,
	"is_voided" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_day_key" UNIQUE("student_id","class_id","attendance_date"),
	CONSTRAINT "attendance_minutes_late_check" CHECK (minutes_late >= 0),
	CONSTRAINT "attendance_status_check" CHECK (status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text])),
	CONSTRAINT "attendance_void_complete" CHECK ((is_voided = false) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"term_id" text,
	"teacher_id" text NOT NULL,
	"evaluation_type" text DEFAULT 'final' NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"term_start" date,
	"term_end" date,
	"score_attendance" smallint NOT NULL,
	"score_behavior" smallint NOT NULL,
	"score_effort" smallint NOT NULL,
	"score_homework" smallint NOT NULL,
	"score_pronunciation" smallint NOT NULL,
	"final_score" smallint NOT NULL,
	"total_score" smallint NOT NULL,
	"rank" text,
	"positive_points" text[] DEFAULT '{""}' NOT NULL,
	"improvement_points" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_term_key" UNIQUE("student_id","class_id","evaluation_type","term_start"),
	CONSTRAINT "evaluation_term_order" CHECK ((term_end IS NULL) OR (term_start IS NULL) OR (term_end >= term_start)),
	CONSTRAINT "evaluations_evaluation_type_check" CHECK (evaluation_type = ANY (ARRAY['midterm'::text, 'final'::text])),
	CONSTRAINT "evaluations_final_score_check" CHECK ((final_score >= 0) AND (final_score <= 100)),
	CONSTRAINT "evaluations_rank_check" CHECK (rank = ANY (ARRAY['first'::text, 'second'::text, 'none'::text])),
	CONSTRAINT "evaluations_score_attendance_check" CHECK ((score_attendance >= 0) AND (score_attendance <= 100)),
	CONSTRAINT "evaluations_score_behavior_check" CHECK ((score_behavior >= 0) AND (score_behavior <= 100)),
	CONSTRAINT "evaluations_score_effort_check" CHECK ((score_effort >= 0) AND (score_effort <= 100)),
	CONSTRAINT "evaluations_score_homework_check" CHECK ((score_homework >= 0) AND (score_homework <= 100)),
	CONSTRAINT "evaluations_score_pronunciation_check" CHECK ((score_pronunciation >= 0) AND (score_pronunciation <= 100)),
	CONSTRAINT "evaluations_total_score_check" CHECK ((total_score >= 0) AND (total_score <= 100))
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"report_date" date NOT NULL,
	"general_comment" text DEFAULT '' NOT NULL,
	"additional_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_report_key" UNIQUE("class_id","report_date")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"attempt_number" smallint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"grade" numeric(5, 2),
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"integrity_session_started_at" timestamp with time zone,
	"integrity_tab_switch_count" integer DEFAULT 0 NOT NULL,
	"integrity_focus_loss_count" integer DEFAULT 0 NOT NULL,
	"integrity_fullscreen_exit_count" integer DEFAULT 0 NOT NULL,
	"integrity_auto_submitted" boolean DEFAULT false NOT NULL,
	"integrity_auto_submit_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_auto_reason" CHECK ((integrity_auto_submitted = false) OR (integrity_auto_submit_reason IS NOT NULL)),
	CONSTRAINT "submissions_attempt_number_check" CHECK (attempt_number > 0),
	CONSTRAINT "submissions_grade_check" CHECK (grade >= (0)::numeric),
	CONSTRAINT "submissions_integrity_focus_loss_count_check" CHECK (integrity_focus_loss_count >= 0),
	CONSTRAINT "submissions_integrity_fullscreen_exit_count_check" CHECK (integrity_fullscreen_exit_count >= 0),
	CONSTRAINT "submissions_integrity_tab_switch_count_check" CHECK (integrity_tab_switch_count >= 0),
	CONSTRAINT "submissions_status_check" CHECK (status = ANY (ARRAY['submitted'::text, 'graded'::text, 'returned'::text]))
);
--> statement-breakpoint
CREATE TABLE "substitute_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"session_id" text,
	"requesting_teacher_id" text NOT NULL,
	"substitute_teacher_id" text,
	"session_date" date NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitute_accepted_has_teacher" CHECK ((status <> 'accepted'::text) OR (substitute_teacher_id IS NOT NULL)),
	CONSTRAINT "substitute_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text])),
	CONSTRAINT "substitute_response_pair" CHECK ((responded_at IS NULL) = (responded_by IS NULL))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"due_date" timestamp with time zone,
	"attempts_allowed" smallint DEFAULT 1 NOT NULL,
	"assessment" jsonb,
	"delivery_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_attempts_allowed_check" CHECK (attempts_allowed > 0),
	CONSTRAINT "assignments_type_check" CHECK (type = ANY (ARRAY['quiz'::text, 'essay'::text, 'assessment'::text]))
);
--> statement-breakpoint
CREATE TABLE "assignment_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"position" smallint NOT NULL,
	"legacy_question_key" bigint,
	"question_content" text NOT NULL,
	"level" text,
	"correct_answer" text NOT NULL,
	CONSTRAINT "assignment_question_position_key" UNIQUE("assignment_id","position"),
	CONSTRAINT "assignment_question_legacy_key" UNIQUE("assignment_id","legacy_question_key"),
	CONSTRAINT "assignment_questions_level_check" CHECK (level = ANY (ARRAY['Nhận biết'::text, 'Thông hiểu'::text, 'Vận dụng thấp'::text, 'Vận dụng cao'::text])),
	CONSTRAINT "assignment_questions_position_check" CHECK ("position" > 0)
);
--> statement-breakpoint
CREATE TABLE "assignment_question_options" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"option_key" text NOT NULL,
	"option_text" text NOT NULL,
	CONSTRAINT "assignment_option_key" UNIQUE("question_id","option_key")
);
--> statement-breakpoint
CREATE TABLE "submission_quiz_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"question_id" text NOT NULL,
	"selected_option" text,
	CONSTRAINT "submission_answer_key" UNIQUE("submission_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "submission_assessment_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"criterion_key" text NOT NULL,
	"score" numeric(6, 2),
	"comment" text,
	CONSTRAINT "submission_assessment_key" UNIQUE("submission_id","criterion_key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_bank_items" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"resource_kind" text NOT NULL,
	"target_type" text NOT NULL,
	"class_id" text,
	"grade" smallint,
	"curriculum_family" text,
	"program_name" text,
	"unit_number" smallint,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_bank_items_download_count_check" CHECK (download_count >= 0),
	CONSTRAINT "knowledge_bank_items_file_size_check" CHECK (file_size >= 0),
	CONSTRAINT "knowledge_bank_items_grade_check" CHECK ((grade >= 1) AND (grade <= 12)),
	CONSTRAINT "knowledge_bank_items_resource_kind_check" CHECK (resource_kind = ANY (ARRAY['document'::text, 'video'::text, 'audio'::text, 'link'::text])),
	CONSTRAINT "knowledge_bank_items_target_type_check" CHECK (target_type = ANY (ARRAY['grade'::text, 'class'::text, 'global'::text])),
	CONSTRAINT "knowledge_bank_items_unit_number_check" CHECK (unit_number > 0),
	CONSTRAINT "knowledge_target_shape" CHECK (((target_type = 'grade'::text) AND (grade IS NOT NULL)) OR ((target_type = 'class'::text) AND (class_id IS NOT NULL)) OR (target_type = 'global'::text))
);
--> statement-breakpoint
CREATE TABLE "curriculums" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"grade" smallint,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculums_grade_check" CHECK ((grade >= 1) AND (grade <= 12))
);
--> statement-breakpoint
CREATE TABLE "course_fee_ledgers" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"enrollment_id" text,
	"term_id" text,
	"term_start" date,
	"term_end" date,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"status" text NOT NULL,
	"period_type" text,
	"month" text,
	"source" text,
	"due_date" date,
	"note" text,
	"legacy_tuition_record_id" text,
	"migration_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_term_key" UNIQUE("student_id","class_id","term_start"),
	CONSTRAINT "course_fee_ledgers_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "course_fee_ledgers_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "course_fee_ledgers_month_check" CHECK ((month IS NULL) OR (month ~ '^\d{4}-\d{2}$'::text)),
	CONSTRAINT "course_fee_ledgers_period_type_check" CHECK (period_type = ANY (ARRAY['course'::text, 'monthly'::text])),
	CONSTRAINT "course_fee_ledgers_source_check" CHECK (source = ANY (ARRAY['course'::text, 'legacy_tuition'::text])),
	CONSTRAINT "course_fee_ledgers_status_check" CHECK (status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'waived'::text])),
	CONSTRAINT "ledger_period_shape" CHECK ((period_type IS NULL) OR ((period_type = 'monthly'::text) AND (month IS NOT NULL)) OR ((period_type = 'course'::text) AND (term_start IS NOT NULL))),
	CONSTRAINT "ledger_term_order" CHECK ((term_end IS NULL) OR (term_start IS NULL) OR (term_end >= term_start))
);
--> statement-breakpoint
CREATE TABLE "exam_bank" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"grade" smallint,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_bank_grade_check" CHECK ((grade >= 1) AND (grade <= 12))
);
--> statement-breakpoint
CREATE TABLE "exam_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_notice_log" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"notice_kind" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sent_by" text NOT NULL,
	"source" text,
	"amount" numeric(14, 2),
	"due_date" date,
	"semester" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_notice_log_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "ledger_notice_log_notice_kind_check" CHECK (notice_kind = ANY (ARRAY['reminder'::text, 'notice'::text])),
	CONSTRAINT "ledger_notice_log_source_check" CHECK (source = ANY (ARRAY['evaluation'::text, 'accounting'::text, 'office'::text, 'system'::text]))
);
--> statement-breakpoint
CREATE TABLE "student_wallets" (
	"student_id" text PRIMARY KEY NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"history_started_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_no" text NOT NULL,
	"type" text DEFAULT 'tuition' NOT NULL,
	"wallet_deposit" boolean DEFAULT false NOT NULL,
	"flow_version" text,
	"transaction_group_id" text,
	"student_id" text NOT NULL,
	"class_id" text,
	"ledger_id" text,
	"invoice_id" text,
	"amount_received" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"payment_method" text NOT NULL,
	"received_date" date NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text,
	"payment_request_id" text,
	"payos_order_code" bigint,
	"payos_payment_link_id" text,
	"payos_reference" text,
	"payment_confirmation_source" text,
	"notification_skipped_reason" text,
	"created_by" text NOT NULL,
	"created_by_role" text NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_receipt_no_key" UNIQUE("receipt_no"),
	CONSTRAINT "receipt_void_complete" CHECK ((status <> 'void'::text) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL))),
	CONSTRAINT "receipts_amount_received_check" CHECK (amount_received >= (0)::numeric),
	CONSTRAINT "receipts_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "receipts_payment_confirmation_source_check" CHECK (payment_confirmation_source = ANY (ARRAY['webhook'::text, 'gateway_status'::text, 'gateway_reconcile'::text])),
	CONSTRAINT "receipts_payment_method_check" CHECK (payment_method = ANY (ARRAY['cash'::text, 'transfer'::text, 'other'::text])),
	CONSTRAINT "receipts_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'payos'::text, 'migration'::text])),
	CONSTRAINT "receipts_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])),
	CONSTRAINT "receipts_type_check" CHECK (type = 'tuition'::text)
);
--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"class_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount_type" text,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2),
	"discount_reason" text,
	"sibling_discount" boolean DEFAULT false NOT NULL,
	"sibling_discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sibling_discount_waived" boolean DEFAULT false NOT NULL,
	"sibling_discount_waived_reason" text,
	CONSTRAINT "receipt_allocation_key" UNIQUE("receipt_id","ledger_id"),
	CONSTRAINT "receipt_allocations_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "receipt_allocations_discount_amount_check" CHECK (discount_amount >= (0)::numeric),
	CONSTRAINT "receipt_allocations_discount_percent_check" CHECK ((discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric)),
	CONSTRAINT "receipt_allocations_discount_type_check" CHECK (discount_type = ANY (ARRAY['none'::text, 'first_prize'::text, 'second_prize'::text, 'full_waiver'::text, 'hardship'::text, 'custom'::text])),
	CONSTRAINT "receipt_allocations_sibling_discount_amount_check" CHECK (sibling_discount_amount >= (0)::numeric),
	CONSTRAINT "sibling_within_discount" CHECK (sibling_discount_amount <= discount_amount)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"schema_version" smallint DEFAULT 2 NOT NULL,
	"transaction_group_id" text,
	"group_sequence" smallint,
	"source" text,
	"student_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"direction" text,
	"status" text NOT NULL,
	"receipt_id" text,
	"ledger_id" text,
	"expense_id" text,
	"class_id" text,
	"note" text DEFAULT '' NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_allocation_has_ledger" CHECK ((type <> 'allocation'::text) OR (ledger_id IS NOT NULL)),
	CONSTRAINT "wallet_direction_scope" CHECK (((type = 'adjustment'::text) AND (direction IS NOT NULL)) OR ((type <> 'adjustment'::text) AND (direction IS NULL))),
	CONSTRAINT "wallet_posted_has_time" CHECK ((status <> 'posted'::text) OR (posted_at IS NOT NULL)),
	CONSTRAINT "wallet_transactions_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "wallet_transactions_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "wallet_transactions_direction_check" CHECK (direction = ANY (ARRAY['in'::text, 'out'::text])),
	CONSTRAINT "wallet_transactions_group_sequence_check" CHECK (group_sequence >= 0),
	CONSTRAINT "wallet_transactions_source_check" CHECK (source = ANY (ARRAY['manual_receipt'::text, 'manual_allocation'::text, 'student_refund'::text])),
	CONSTRAINT "wallet_transactions_status_check" CHECK (status = ANY (ARRAY['proposed'::text, 'posted'::text, 'rejected'::text, 'void'::text])),
	CONSTRAINT "wallet_transactions_type_check" CHECK (type = ANY (ARRAY['deposit'::text, 'allocation'::text, 'credit'::text, 'refund'::text, 'adjustment'::text])),
	CONSTRAINT "wallet_void_complete" CHECK ((status <> 'void'::text) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"ledger_id" text NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"parent_uid" text,
	"currency" text DEFAULT 'VND' NOT NULL,
	"status" text NOT NULL,
	"amount_due" numeric(14, 2) NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ledger_amount_snapshot" numeric(14, 2) NOT NULL,
	"paid_total_snapshot" numeric(14, 2) NOT NULL,
	"discount_total_snapshot" numeric(14, 2) NOT NULL,
	"student_name_snapshot" text NOT NULL,
	"class_name_snapshot" text NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_no_key" UNIQUE("invoice_no"),
	CONSTRAINT "invoice_superseded_pair" CHECK ((superseded_at IS NULL) = (superseded_by_invoice_id IS NULL)),
	CONSTRAINT "invoices_amount_due_check" CHECK (amount_due >= (0)::numeric),
	CONSTRAINT "invoices_amount_paid_check" CHECK (amount_paid >= (0)::numeric),
	CONSTRAINT "invoices_currency_check" CHECK (currency = 'VND'::text),
	CONSTRAINT "invoices_status_check" CHECK (status = ANY (ARRAY['issued'::text, 'partially_paid'::text, 'paid'::text, 'void'::text, 'superseded'::text]))
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"position" smallint NOT NULL,
	"type" text NOT NULL,
	"ledger_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "invoice_line_position_key" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_line_items_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "invoice_line_items_position_check" CHECK ("position" > 0),
	CONSTRAINT "invoice_line_items_type_check" CHECK (type = 'tuition'::text)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"expense_no" text NOT NULL,
	"type" text,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"paid_date" date NOT NULL,
	"payee" text NOT NULL,
	"purpose" text,
	"note" text,
	"reason" text,
	"student_id" text,
	"class_id" text,
	"wallet_transaction_id" text,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_no_key" UNIQUE("expense_no"),
	CONSTRAINT "expense_wallet_refund_shape" CHECK ((type IS DISTINCT FROM 'wallet_refund'::text) OR ((student_id IS NOT NULL) AND (wallet_transaction_id IS NOT NULL))),
	CONSTRAINT "expenses_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "expenses_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "expenses_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])),
	CONSTRAINT "expenses_type_check" CHECK (type = ANY (ARRAY['activity'::text, 'wallet_refund'::text]))
);
--> statement-breakpoint
CREATE TABLE "tuition_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"default_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"due_day_of_month" smallint NOT NULL,
	"auto_generate_monthly" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tuition_config_class_key" UNIQUE("class_id"),
	CONSTRAINT "tuition_configs_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "tuition_configs_default_amount_check" CHECK (default_amount >= (0)::numeric),
	CONSTRAINT "tuition_configs_due_day_of_month_check" CHECK ((due_day_of_month >= 1) AND (due_day_of_month <= 31))
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"order_code" bigint NOT NULL,
	"provider" text DEFAULT 'payos' NOT NULL,
	"ledger_id" text NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"parent_uid" text NOT NULL,
	"invoice_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"status" text NOT NULL,
	"gateway_status" text,
	"payment_link_id" text,
	"checkout_url" text,
	"qr_code" text,
	"return_url" text,
	"cancel_url" text,
	"description" text,
	"receipt_id" text,
	"review_reason" text,
	"review_resolution" text,
	"accounting_resolution" text,
	"failure_reason" text,
	"stale_reason" text,
	"gateway_amount" numeric(14, 2),
	"gateway_reference" text,
	"gateway_snapshot" jsonb,
	"reconciliation_checked_at" timestamp with time zone,
	"reconciliation_error" text,
	"invoice_amount_snapshot" numeric(14, 2),
	"invoice_snapshot_version" integer,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_order_code_key" UNIQUE("order_code"),
	CONSTRAINT "payment_requests_accounting_resolution_check" CHECK (accounting_resolution = ANY (ARRAY['receipt_voided_manual_handling'::text, 'manual_receipt_posted_while_gateway_session_active'::text])),
	CONSTRAINT "payment_requests_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "payment_requests_currency_check" CHECK (currency = 'VND'::text),
	CONSTRAINT "payment_requests_provider_check" CHECK (provider = 'payos'::text),
	CONSTRAINT "payment_requests_review_resolution_check" CHECK (review_resolution = ANY (ARRAY['approved'::text, 'rejected'::text, 'manual_handling_required'::text])),
	CONSTRAINT "payment_requests_status_check" CHECK (status = ANY (ARRAY['creating_gateway_session'::text, 'pending'::text, 'paid'::text, 'cancelled'::text, 'expired'::text, 'stale'::text, 'failed'::text, 'create_failed'::text, 'needs_review'::text, 'manually_voided'::text]))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'payos' NOT NULL,
	"event_hash" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"envelope_code" text,
	"envelope_desc" text,
	"envelope_success" boolean,
	"order_code" bigint,
	"amount" numeric(14, 2),
	"payment_link_id" text,
	"provider_reference" text,
	"provider_code" text,
	"processing_status" text NOT NULL,
	"processing_message" text,
	"error" text,
	"payment_request_id" text,
	"receipt_id" text,
	"raw_payload" jsonb,
	"transaction_datetime" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_hash_key" UNIQUE("event_hash"),
	CONSTRAINT "webhook_events_provider_check" CHECK (provider = 'payos'::text)
);
--> statement-breakpoint
CREATE TABLE "payment_order_codes" (
	"order_code" bigint PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'payos' NOT NULL,
	"status" text NOT NULL,
	"ledger_id" text,
	"student_id" text,
	"class_id" text,
	"parent_uid" text,
	"payment_request_id" text,
	"amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_codes_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "payment_order_codes_provider_check" CHECK (provider = 'payos'::text),
	CONSTRAINT "payment_order_codes_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'used'::text, 'released'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance_monthly_aggregates" (
	"month" text PRIMARY KEY NOT NULL,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"total_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_expenses" numeric(14, 2) DEFAULT '0' NOT NULL,
	"income_by_level" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expenses_by_category" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_month_range_order" CHECK (range_end >= range_start),
	CONSTRAINT "finance_monthly_aggregates_month_check" CHECK (month ~ '^\d{4}-\d{2}$'::text)
);
--> statement-breakpoint
CREATE TABLE "course_closings" (
	"id" text PRIMARY KEY NOT NULL,
	"term_id" text NOT NULL,
	"course_id" text,
	"term_start" date NOT NULL,
	"term_end" date,
	"approval_status" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"approved_by_role" text,
	"approval_source" text,
	"roster_fingerprint" text,
	"evaluation_fingerprint" text,
	"invalidated_at" timestamp with time zone,
	"invalidated_by" text,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_closing_term_key" UNIQUE("term_id"),
	CONSTRAINT "course_closing_approved_complete" CHECK ((approval_status IS DISTINCT FROM 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_by IS NOT NULL))),
	CONSTRAINT "course_closing_invalidated_complete" CHECK ((approval_status IS DISTINCT FROM 'invalidated'::text) OR ((invalidated_at IS NOT NULL) AND (invalidated_reason IS NOT NULL))),
	CONSTRAINT "course_closing_term_order" CHECK ((term_end IS NULL) OR (term_end >= term_start)),
	CONSTRAINT "course_closings_approval_source_check" CHECK (approval_source = ANY (ARRAY['teacher'::text, 'admin'::text, 'system'::text])),
	CONSTRAINT "course_closings_approval_status_check" CHECK (approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'invalidated'::text])),
	CONSTRAINT "course_closings_approved_by_role_check" CHECK (approved_by_role = ANY (ARRAY['teacher'::text, 'admin'::text, 'office'::text]))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text,
	"ledger_id" text,
	"expense_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_approval_pair" CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
	CONSTRAINT "refunds_amount_check" CHECK (amount > (0)::numeric),
	CONSTRAINT "refunds_currency_check" CHECK (currency = ANY (ARRAY['VND'::text, 'USD'::text])),
	CONSTRAINT "refunds_status_check" CHECK (status = ANY (ARRAY['proposed'::text, 'approved'::text, 'paid'::text, 'rejected'::text, 'void'::text]))
);
--> statement-breakpoint
CREATE TABLE "tuition_records" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text,
	"month" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"request_fingerprint" text,
	"ledger_ids" text[] DEFAULT '{""}' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_idempotency_key_unique" UNIQUE("uid","idempotency_key"),
	CONSTRAINT "finance_idempotency_keys_status_check" CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "course_closing_exemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"closing_id" text NOT NULL,
	"student_id" text NOT NULL,
	"reason" text,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_closing_exemption_key" UNIQUE("closing_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "course_closing_records" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"term_id" text,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"course_id" text NOT NULL,
	"closing_month" text NOT NULL,
	"course_start_date" date NOT NULL,
	"course_end_date" date NOT NULL,
	"record_version" smallint DEFAULT 1 NOT NULL,
	"student_code_snapshot" text NOT NULL,
	"student_name_snapshot" text NOT NULL,
	"class_name_snapshot" text NOT NULL,
	"teacher_name_snapshot" text NOT NULL,
	"evaluation_id" text,
	"evaluation_version" text,
	"evaluation_date_snapshot" date,
	"evaluation_classification" text,
	"evaluation_final_score" smallint,
	"evaluation_total_score" smallint,
	"evaluation_positive_points" text[] DEFAULT '{""}' NOT NULL,
	"evaluation_improvement_points" text,
	"evaluation_scores_snapshot" jsonb,
	"evaluation_midterm_snapshot" jsonb,
	"tuition_ledger_id" text,
	"tuition_amount_snapshot" numeric(14, 2),
	"tuition_notice_date" date,
	"next_course_start_date" date,
	"next_course_end_date" date,
	"tuition_final_exam_date" date,
	"tuition_final_exam_score" smallint,
	"evaluation_availability_status" text,
	"evaluation_availability_reason" text,
	"evaluation_availability_assessed_at" timestamp with time zone,
	"tuition_availability_status" text,
	"tuition_availability_reason" text,
	"tuition_availability_assessed_at" timestamp with time zone,
	"backfilled_at" timestamp with time zone,
	"backfill_source_digest" text,
	"backfill_version" smallint,
	"repair_source" text,
	"repaired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_record_course_student_key" UNIQUE("student_id","course_id"),
	CONSTRAINT "closing_record_date_order" CHECK (course_end_date >= course_start_date),
	CONSTRAINT "course_closing_records_closing_month_check" CHECK (closing_month ~ '^\d{4}-\d{2}$'::text),
	CONSTRAINT "course_closing_records_evaluation_availability_status_check" CHECK (evaluation_availability_status = ANY (ARRAY['verified'::text, 'unavailable'::text])),
	CONSTRAINT "course_closing_records_evaluation_classification_check" CHECK (evaluation_classification = ANY (ARRAY['excellent'::text, 'good'::text, 'fair'::text, 'failing'::text])),
	CONSTRAINT "course_closing_records_evaluation_final_score_check" CHECK ((evaluation_final_score >= 0) AND (evaluation_final_score <= 100)),
	CONSTRAINT "course_closing_records_evaluation_total_score_check" CHECK ((evaluation_total_score >= 0) AND (evaluation_total_score <= 100)),
	CONSTRAINT "course_closing_records_tuition_amount_snapshot_check" CHECK (tuition_amount_snapshot >= (0)::numeric),
	CONSTRAINT "course_closing_records_tuition_availability_status_check" CHECK (tuition_availability_status = ANY (ARRAY['verified'::text, 'unavailable'::text])),
	CONSTRAINT "course_closing_records_tuition_final_exam_score_check" CHECK ((tuition_final_exam_score >= 0) AND (tuition_final_exam_score <= 100))
);
--> statement-breakpoint
CREATE TABLE "course_closing_record_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"storage_path" text,
	"preview_storage_path" text,
	"download_filename" text,
	"mime_type" text,
	"template_version" smallint DEFAULT 1 NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"source_notification_id" text,
	CONSTRAINT "closing_document_kind_key" UNIQUE("record_id","kind"),
	CONSTRAINT "closing_document_ready_has_file" CHECK ((status <> 'ready'::text) OR ((storage_path IS NOT NULL) AND (generated_at IS NOT NULL))),
	CONSTRAINT "course_closing_record_documents_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "course_closing_record_documents_kind_check" CHECK (kind = ANY (ARRAY['evaluation'::text, 'tuition'::text])),
	CONSTRAINT "course_closing_record_documents_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'generating'::text, 'ready'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "teacher_availability_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_profile_teacher_key" UNIQUE("teacher_id"),
	CONSTRAINT "teacher_availability_profiles_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "teacher_availability_profile_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"day_key" text NOT NULL,
	"slot_id" text NOT NULL,
	CONSTRAINT "availability_selection_key" UNIQUE("profile_id","day_key","slot_id"),
	CONSTRAINT "teacher_availability_profile_selections_day_key_check" CHECK (day_key = ANY (ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text]))
);
--> statement-breakpoint
CREATE TABLE "teacher_availability_slots" (
	"slot_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"start_time" time,
	"end_time" time,
	"position" smallint NOT NULL,
	CONSTRAINT "availability_slot_position_key" UNIQUE("position"),
	CONSTRAINT "availability_slot_time_order" CHECK ((end_time IS NULL) OR (start_time IS NULL) OR (end_time > start_time))
);
--> statement-breakpoint
CREATE TABLE "teacher_availability_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"profile_id" text,
	"status" text NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_request_review_pair" CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
	CONSTRAINT "teacher_availability_change_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "teacher_availability_change_request_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"day_key" text NOT NULL,
	"slot_id" text NOT NULL,
	CONSTRAINT "availability_request_selection_key" UNIQUE("request_id","day_key","slot_id"),
	CONSTRAINT "teacher_availability_change_request_selections_day_key_check" CHECK (day_key = ANY (ARRAY['mon'::text, 'tue'::text, 'wed'::text, 'thu'::text, 'fri'::text, 'sat'::text, 'sun'::text]))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text,
	"teacher_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"counts_by_type" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_id" text,
	"order_code" bigint,
	"amount" numeric(14, 2),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_notifications_type_check" CHECK (type = ANY (ARRAY['zalo_failure_digest'::text, 'payment_needs_review'::text, 'payment_failed'::text, 'system_alert'::text]))
);
--> statement-breakpoint
CREATE TABLE "admin_notification_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_notification_id" text NOT NULL,
	"zalo_notification_id" text,
	"student_id" text,
	"phone" text,
	"failure_type" text NOT NULL,
	"error_message" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zalo_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"zalo_message_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"phone" text NOT NULL,
	"student_id" text,
	"class_id" text,
	"term_id" text,
	"teacher_id" text,
	"evaluation_id" text,
	"notification_date" date,
	"amount" numeric(14, 2),
	"template_id" text,
	"recipient_role" text,
	"error_message" text DEFAULT '' NOT NULL,
	"provider_error_code" integer,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"resend_by" text,
	"payload_snapshot" jsonb,
	"snapshot_checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_notification_failed_has_error" CHECK ((status <> 'failed'::text) OR (error_message <> ''::text)),
	CONSTRAINT "zalo_notification_sent_has_time" CHECK ((status <> 'sent'::text) OR (sent_at IS NOT NULL)),
	CONSTRAINT "zalo_notifications_amount_check" CHECK (amount >= (0)::numeric),
	CONSTRAINT "zalo_notifications_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))
);
--> statement-breakpoint
CREATE TABLE "zalo_bot_links" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"chat_id_hash" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text,
	"status" text NOT NULL,
	"confirmation_status" text,
	"linked_method" text,
	"linked_by" text,
	"linked_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_bot_link_staff_key" UNIQUE("staff_id"),
	CONSTRAINT "zalo_bot_link_chat_key" UNIQUE("chat_id_hash"),
	CONSTRAINT "zalo_bot_links_confirmation_status_check" CHECK (confirmation_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text])),
	CONSTRAINT "zalo_bot_links_linked_method_check" CHECK (linked_method = ANY (ARRAY['self'::text, 'admin'::text])),
	CONSTRAINT "zalo_bot_links_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])),
	CONSTRAINT "zalo_bot_links_status_check" CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text]))
);
--> statement-breakpoint
CREATE TABLE "zalo_bot_link_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_chat_id_hash" text,
	CONSTRAINT "link_code_consumed_pair" CHECK ((consumed_at IS NULL) = (consumed_by_chat_id_hash IS NULL)),
	CONSTRAINT "link_code_expiry_after_issue" CHECK (expires_at > issued_at),
	CONSTRAINT "zalo_bot_link_codes_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text]))
);
--> statement-breakpoint
CREATE TABLE "zalo_bot_chat_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"released" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "chat_claim_release_pair" CHECK ((released = false) = (released_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "zalo_bot_chat_sessions" (
	"staff_id" text PRIMARY KEY NOT NULL,
	"last_intent" text,
	"last_class_id" text,
	"last_asked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_session_expiry_after_ask" CHECK (expires_at > last_asked_at)
);
--> statement-breakpoint
CREATE TABLE "zalo_bot_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"chat_id_hash" text NOT NULL,
	"role" text NOT NULL,
	"message_type" text NOT NULL,
	"digest_date" date NOT NULL,
	"status" text NOT NULL,
	"content_snapshot" text,
	"provider_message_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_bot_messages_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "zalo_bot_messages_message_type_check" CHECK (message_type = ANY (ARRAY['daily_digest'::text, 'chat_reply'::text, 'link_confirmation'::text])),
	CONSTRAINT "zalo_bot_messages_role_check" CHECK (role = ANY (ARRAY['teacher'::text, 'admin'::text, 'accounting'::text, 'office'::text])),
	CONSTRAINT "zalo_bot_messages_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "zalo_bulk_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"course_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"requested_count" integer NOT NULL,
	"valid_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_job_counts_add_up" CHECK ((success_count + failure_count) <= valid_count),
	CONSTRAINT "bulk_job_valid_within_requested" CHECK (valid_count <= requested_count),
	CONSTRAINT "zalo_bulk_jobs_failure_count_check" CHECK (failure_count >= 0),
	CONSTRAINT "zalo_bulk_jobs_requested_count_check" CHECK (requested_count >= 0),
	CONSTRAINT "zalo_bulk_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'partial_failure'::text, 'failed'::text])),
	CONSTRAINT "zalo_bulk_jobs_success_count_check" CHECK (success_count >= 0),
	CONSTRAINT "zalo_bulk_jobs_type_check" CHECK (type = ANY (ARRAY['evaluation'::text, 'rank_achievement'::text, 'tuition_notice'::text])),
	CONSTRAINT "zalo_bulk_jobs_valid_count_check" CHECK (valid_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "zalo_bulk_job_items" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"student_id" text NOT NULL,
	"class_id" text NOT NULL,
	"course_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"message_id" text,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_job_item_key" UNIQUE("job_id","student_id"),
	CONSTRAINT "zalo_bulk_job_items_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])),
	CONSTRAINT "zalo_bulk_job_items_type_check" CHECK (type = ANY (ARRAY['evaluation'::text, 'rank_achievement'::text, 'tuition_notice'::text]))
);
--> statement-breakpoint
CREATE TABLE "zalo_config" (
	"id" text PRIMARY KEY DEFAULT 'tokens' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_config_id_check" CHECK (id = 'tokens'::text)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"user_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"changes" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"requested_by_id" text,
	"requested_by_role" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_completion_order" CHECK ((completed_at IS NULL) OR (started_at IS NULL) OR (completed_at >= started_at)),
	CONSTRAINT "jobs_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "jobs_duration_ms_check" CHECK (duration_ms >= 0),
	CONSTRAINT "jobs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))
);
--> statement-breakpoint
CREATE TABLE "print_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" text,
	"title" text NOT NULL,
	"note" text,
	"copies" smallint DEFAULT 1 NOT NULL,
	"needed_by" date,
	"status" text NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_request_handled_pair" CHECK ((handled_at IS NULL) = (handled_by IS NULL)),
	CONSTRAINT "print_requests_copies_check" CHECK (copies > 0),
	CONSTRAINT "print_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'printed'::text, 'rejected'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "print_request_files" (
	"id" text PRIMARY KEY NOT NULL,
	"print_request_id" text NOT NULL,
	"position" smallint NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text,
	"file_size" bigint,
	CONSTRAINT "print_request_file_position_key" UNIQUE("print_request_id","position"),
	CONSTRAINT "print_request_files_file_size_check" CHECK (file_size >= 0),
	CONSTRAINT "print_request_files_position_check" CHECK ("position" > 0)
);
--> statement-breakpoint
CREATE TABLE "student_enrollment_migration_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"migration_id" text NOT NULL,
	"run_id" text NOT NULL,
	"student_id" text NOT NULL,
	"document_id" text NOT NULL,
	"digest" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"target_project_id" text NOT NULL,
	"target_database_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"locked_by" text,
	"processing_started_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "outbox_jobs_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "outbox_jobs_max_attempts_check" CHECK (max_attempts > 0),
	CONSTRAINT "outbox_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'dead'::text])),
	CONSTRAINT "outbox_lock_pair" CHECK ((locked_by IS NULL) = (processing_started_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"job_name" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"checked" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"error_code" text DEFAULT '' NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_run_finished_unless_running" CHECK ((status = 'running'::text) OR (finished_at IS NOT NULL)),
	CONSTRAINT "job_run_order" CHECK ((finished_at IS NULL) OR (finished_at >= started_at)),
	CONSTRAINT "job_runs_changed_check" CHECK (changed >= 0),
	CONSTRAINT "job_runs_checked_check" CHECK (checked >= 0),
	CONSTRAINT "job_runs_status_check" CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "student_auth_credentials" ADD CONSTRAINT "student_auth_credentials_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_email_access" ADD CONSTRAINT "staff_email_access_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_account_requests" ADD CONSTRAINT "staff_account_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_password_reset_requests" ADD CONSTRAINT "staff_password_reset_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_password_reset_requests" ADD CONSTRAINT "staff_password_reset_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_registration_requests" ADD CONSTRAINT "teacher_registration_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions_history" ADD CONSTRAINT "admissions_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions_history" ADD CONSTRAINT "admissions_history_class_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions_history" ADD CONSTRAINT "admissions_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions_history" ADD CONSTRAINT "admissions_history_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progression_events" ADD CONSTRAINT "student_progression_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progression_events" ADD CONSTRAINT "student_progression_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progression_events" ADD CONSTRAINT "student_progression_from_class_fkey" FOREIGN KEY ("from_class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progression_events" ADD CONSTRAINT "student_progression_to_class_fkey" FOREIGN KEY ("to_class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_term_weekly_sessions" ADD CONSTRAINT "class_term_weekly_sessions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_holidays" ADD CONSTRAINT "class_holidays_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_import_source_class_id_fkey" FOREIGN KEY ("import_source_class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_terms" ADD CONSTRAINT "class_terms_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_admitted_by_fkey" FOREIGN KEY ("admitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_trial_class_fkey" FOREIGN KEY ("trial_class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_trial_teacher_fkey" FOREIGN KEY ("trial_teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_course_enrollments" ADD CONSTRAINT "student_course_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_course_enrollments" ADD CONSTRAINT "student_course_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_course_enrollments" ADD CONSTRAINT "student_course_enrollments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_periods" ADD CONSTRAINT "student_leave_periods_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_periods" ADD CONSTRAINT "student_leave_periods_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_course_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_requesting_teacher_id_fkey" FOREIGN KEY ("requesting_teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_responded_by_fkey" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_substitute_teacher_id_fkey" FOREIGN KEY ("substitute_teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_question_answer_exists" FOREIGN KEY ("id","correct_answer") REFERENCES "public"."assignment_question_options"("question_id","option_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_question_options" ADD CONSTRAINT "assignment_question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_quiz_answers" ADD CONSTRAINT "submission_quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_quiz_answers" ADD CONSTRAINT "submission_quiz_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_assessment_answers" ADD CONSTRAINT "submission_assessment_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bank_items" ADD CONSTRAINT "knowledge_bank_items_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bank_items" ADD CONSTRAINT "knowledge_bank_items_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculums" ADD CONSTRAINT "curriculums_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_fee_ledgers" ADD CONSTRAINT "course_fee_ledgers_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_fee_ledgers" ADD CONSTRAINT "course_fee_ledgers_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_course_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_fee_ledgers" ADD CONSTRAINT "course_fee_ledgers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_fee_ledgers" ADD CONSTRAINT "course_fee_ledgers_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_bank" ADD CONSTRAINT "exam_bank_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_templates" ADD CONSTRAINT "exam_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_notice_log" ADD CONSTRAINT "ledger_notice_log_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_wallets" ADD CONSTRAINT "student_wallets_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_request_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_tx_expense_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_superseded_by_invoice_id_fkey" FOREIGN KEY ("superseded_by_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuition_configs" ADD CONSTRAINT "tuition_configs_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuition_configs" ADD CONSTRAINT "tuition_configs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_codes" ADD CONSTRAINT "payment_order_codes_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_codes" ADD CONSTRAINT "payment_order_codes_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_codes" ADD CONSTRAINT "payment_order_codes_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_codes" ADD CONSTRAINT "payment_order_codes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closings" ADD CONSTRAINT "course_closings_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closings" ADD CONSTRAINT "course_closings_invalidated_by_fkey" FOREIGN KEY ("invalidated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closings" ADD CONSTRAINT "course_closings_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "public"."course_fee_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_exemptions" ADD CONSTRAINT "course_closing_exemptions_closing_id_fkey" FOREIGN KEY ("closing_id") REFERENCES "public"."course_closings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_exemptions" ADD CONSTRAINT "course_closing_exemptions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_exemptions" ADD CONSTRAINT "course_closing_exemptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_records" ADD CONSTRAINT "course_closing_records_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_records" ADD CONSTRAINT "course_closing_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_records" ADD CONSTRAINT "course_closing_records_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_records" ADD CONSTRAINT "course_closing_records_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_closing_record_documents" ADD CONSTRAINT "course_closing_record_documents_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."course_closing_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_profiles" ADD CONSTRAINT "teacher_availability_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_profiles" ADD CONSTRAINT "teacher_availability_profiles_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_profiles" ADD CONSTRAINT "teacher_availability_profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_profile_selections" ADD CONSTRAINT "teacher_availability_profile_selections_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."teacher_availability_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_profile_selections" ADD CONSTRAINT "teacher_availability_profile_selections_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."teacher_availability_slots"("slot_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_change_requests" ADD CONSTRAINT "teacher_availability_change_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."teacher_availability_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_change_requests" ADD CONSTRAINT "teacher_availability_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_change_requests" ADD CONSTRAINT "teacher_availability_change_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_change_request_selections" ADD CONSTRAINT "teacher_availability_change_request_selections_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."teacher_availability_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_availability_change_request_selections" ADD CONSTRAINT "teacher_availability_change_request_selections_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."teacher_availability_slots"("slot_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notification_failures" ADD CONSTRAINT "admin_notification_failures_admin_notification_id_fkey" FOREIGN KEY ("admin_notification_id") REFERENCES "public"."admin_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notification_failures" ADD CONSTRAINT "admin_notification_failures_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notification_failures" ADD CONSTRAINT "admin_notification_failures_zalo_fkey" FOREIGN KEY ("zalo_notification_id") REFERENCES "public"."zalo_notifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_notifications" ADD CONSTRAINT "zalo_notifications_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."class_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_links" ADD CONSTRAINT "zalo_bot_links_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_links" ADD CONSTRAINT "zalo_bot_links_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_link_codes" ADD CONSTRAINT "zalo_bot_link_codes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_chat_claims" ADD CONSTRAINT "zalo_bot_chat_claims_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_chat_sessions" ADD CONSTRAINT "zalo_bot_chat_sessions_last_class_id_fkey" FOREIGN KEY ("last_class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_chat_sessions" ADD CONSTRAINT "zalo_bot_chat_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bot_messages" ADD CONSTRAINT "zalo_bot_messages_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_jobs" ADD CONSTRAINT "zalo_bulk_jobs_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_jobs" ADD CONSTRAINT "zalo_bulk_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_job_items" ADD CONSTRAINT "zalo_bulk_job_items_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_job_items" ADD CONSTRAINT "zalo_bulk_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."zalo_bulk_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_job_items" ADD CONSTRAINT "zalo_bulk_job_items_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."zalo_notifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_bulk_job_items" ADD CONSTRAINT "zalo_bulk_job_items_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_request_files" ADD CONSTRAINT "print_request_files_print_request_id_fkey" FOREIGN KEY ("print_request_id") REFERENCES "public"."print_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_account_requests_status_idx" ON "staff_account_requests" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "password_reset_requests_status_idx" ON "password_reset_requests" USING btree ("status" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "password_reset_requests_student_idx" ON "password_reset_requests" USING btree ("student_id" text_ops,"requested_at" text_ops);--> statement-breakpoint
CREATE INDEX "staff_password_reset_status_idx" ON "staff_password_reset_requests" USING btree ("status" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "admissions_history_student_idx" ON "admissions_history" USING btree ("student_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "student_progression_events_op_idx" ON "student_progression_events" USING btree ("operation_id" text_ops) WHERE (operation_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "student_progression_events_student_idx" ON "student_progression_events" USING btree ("student_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "class_term_weekly_sessions_term_idx" ON "class_term_weekly_sessions" USING btree ("term_id" text_ops);--> statement-breakpoint
CREATE INDEX "class_sessions_class_date_idx" ON "class_sessions" USING btree ("class_id" date_ops,"session_date" text_ops);--> statement-breakpoint
CREATE INDEX "class_sessions_teacher_idx" ON "class_sessions" USING btree ("teacher_id" date_ops,"session_date" date_ops);--> statement-breakpoint
CREATE INDEX "class_sessions_term_idx" ON "class_sessions" USING btree ("term_id" text_ops) WHERE (term_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "classes_status_idx" ON "classes" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id" text_ops);--> statement-breakpoint
CREATE INDEX "class_terms_class_idx" ON "class_terms" USING btree ("class_id" text_ops,"term_start" date_ops);--> statement-breakpoint
CREATE INDEX "class_terms_course_id_idx" ON "class_terms" USING btree ("course_id" text_ops) WHERE (course_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "class_terms_open_idx" ON "class_terms" USING btree ("class_id" text_ops) WHERE (term_end IS NULL);--> statement-breakpoint
CREATE INDEX "class_terms_range_idx" ON "class_terms" USING gist (class_id gist_text_ops,daterange(term_start, term_end, '[]'::text) range_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "students_code_normalized_key" ON "students" USING btree ("code_normalized" text_ops);--> statement-breakpoint
CREATE INDEX "students_contact_idx" ON "students" USING btree ("contact" text_ops);--> statement-breakpoint
CREATE INDEX "students_dob_idx" ON "students" USING btree ("dob" date_ops);--> statement-breakpoint
CREATE INDEX "students_lifecycle_idx" ON "students" USING btree ("student_lifecycle" text_ops);--> statement-breakpoint
CREATE INDEX "students_name_trgm_idx" ON "students" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower(email) text_ops) WHERE (email IS NOT NULL);--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone" text_ops) WHERE (phone IS NOT NULL);--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role" text_ops);--> statement-breakpoint
CREATE INDEX "users_student_id_idx" ON "users" USING btree ("student_id" text_ops);--> statement-breakpoint
CREATE INDEX "enrollment_class_idx" ON "student_course_enrollments" USING btree ("class_id" text_ops,"term_start" text_ops);--> statement-breakpoint
CREATE INDEX "enrollment_open_idx" ON "student_course_enrollments" USING btree ("student_id" text_ops) WHERE (status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text]));--> statement-breakpoint
CREATE INDEX "enrollment_student_idx" ON "student_course_enrollments" USING btree ("student_id" date_ops,"term_start" date_ops);--> statement-breakpoint
CREATE INDEX "student_leave_periods_student_idx" ON "student_leave_periods" USING btree ("student_id" date_ops,"leave_from" date_ops);--> statement-breakpoint
CREATE INDEX "attendance_class_date_idx" ON "attendance" USING btree ("class_id" date_ops,"attendance_date" text_ops);--> statement-breakpoint
CREATE INDEX "attendance_live_idx" ON "attendance" USING btree ("class_id" text_ops,"attendance_date" text_ops) WHERE (is_voided = false);--> statement-breakpoint
CREATE INDEX "attendance_student_date_idx" ON "attendance" USING btree ("student_id" date_ops,"attendance_date" text_ops);--> statement-breakpoint
CREATE INDEX "evaluations_class_idx" ON "evaluations" USING btree ("class_id" timestamptz_ops,"evaluated_at" text_ops);--> statement-breakpoint
CREATE INDEX "evaluations_student_idx" ON "evaluations" USING btree ("student_id" text_ops,"evaluated_at" text_ops);--> statement-breakpoint
CREATE INDEX "evaluations_term_idx" ON "evaluations" USING btree ("term_id" text_ops) WHERE (term_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "submissions_assignment_idx" ON "submissions" USING btree ("assignment_id" text_ops,"submitted_at" text_ops);--> statement-breakpoint
CREATE INDEX "submissions_attempt_idx" ON "submissions" USING btree ("assignment_id" text_ops,"student_id" int2_ops,"attempt_number" int2_ops);--> statement-breakpoint
CREATE INDEX "submissions_student_idx" ON "submissions" USING btree ("student_id" timestamptz_ops,"submitted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "substitute_requests_class_idx" ON "substitute_requests" USING btree ("class_id" date_ops,"session_date" date_ops);--> statement-breakpoint
CREATE INDEX "substitute_requests_status_idx" ON "substitute_requests" USING btree ("status" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "assignments_class_idx" ON "assignments" USING btree ("class_id" text_ops,"due_date" text_ops);--> statement-breakpoint
CREATE INDEX "submission_quiz_answers_question_idx" ON "submission_quiz_answers" USING btree ("question_id" text_ops);--> statement-breakpoint
CREATE INDEX "knowledge_bank_class_idx" ON "knowledge_bank_items" USING btree ("class_id" text_ops) WHERE (class_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "knowledge_bank_grade_idx" ON "knowledge_bank_items" USING btree ("grade" int2_ops,"unit_number" int2_ops);--> statement-breakpoint
CREATE INDEX "ledger_class_idx" ON "course_fee_ledgers" USING btree ("class_id" date_ops,"term_start" text_ops);--> statement-breakpoint
CREATE INDEX "ledger_enrollment_idx" ON "course_fee_ledgers" USING btree ("enrollment_id" text_ops) WHERE (enrollment_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ledger_open_idx" ON "course_fee_ledgers" USING btree ("status" date_ops,"due_date" text_ops) WHERE (status = ANY (ARRAY['unpaid'::text, 'partial'::text]));--> statement-breakpoint
CREATE INDEX "ledger_student_idx" ON "course_fee_ledgers" USING btree ("student_id" date_ops,"term_start" text_ops);--> statement-breakpoint
CREATE INDEX "ledger_notice_log_ledger_idx" ON "ledger_notice_log" USING btree ("ledger_id" text_ops,"sent_at" text_ops);--> statement-breakpoint
CREATE INDEX "receipts_date_idx" ON "receipts" USING btree ("received_date" date_ops) WHERE (status = 'posted'::text);--> statement-breakpoint
CREATE INDEX "receipts_group_idx" ON "receipts" USING btree ("transaction_group_id" text_ops) WHERE (transaction_group_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "receipts_student_idx" ON "receipts" USING btree ("student_id" text_ops,"received_date" date_ops);--> statement-breakpoint
CREATE INDEX "receipt_allocations_ledger_idx" ON "receipt_allocations" USING btree ("ledger_id" text_ops);--> statement-breakpoint
CREATE INDEX "wallet_tx_group_idx" ON "wallet_transactions" USING btree ("transaction_group_id" text_ops) WHERE (transaction_group_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "wallet_tx_ledger_idx" ON "wallet_transactions" USING btree ("ledger_id" text_ops) WHERE (ledger_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "wallet_tx_posted_idx" ON "wallet_transactions" USING btree ("student_id" text_ops) WHERE (status = 'posted'::text);--> statement-breakpoint
CREATE INDEX "wallet_tx_student_idx" ON "wallet_transactions" USING btree ("student_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "invoices_ledger_idx" ON "invoices" USING btree ("ledger_id" text_ops);--> statement-breakpoint
CREATE INDEX "invoices_student_idx" ON "invoices" USING btree ("student_id" text_ops,"issued_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category" date_ops,"paid_date" date_ops);--> statement-breakpoint
CREATE INDEX "expenses_paid_date_idx" ON "expenses" USING btree ("paid_date" date_ops) WHERE (status = 'posted'::text);--> statement-breakpoint
CREATE INDEX "payment_requests_ledger_idx" ON "payment_requests" USING btree ("ledger_id" text_ops);--> statement-breakpoint
CREATE INDEX "payment_requests_status_idx" ON "payment_requests" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "webhook_events_order_code_idx" ON "webhook_events" USING btree ("order_code" int8_ops) WHERE (order_code IS NOT NULL);--> statement-breakpoint
CREATE INDEX "course_closings_status_idx" ON "course_closings" USING btree ("approval_status" text_ops);--> statement-breakpoint
CREATE INDEX "finance_idempotency_created_idx" ON "finance_idempotency_keys" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "closing_records_class_idx" ON "course_closing_records" USING btree ("class_id" text_ops,"closing_month" text_ops);--> statement-breakpoint
CREATE INDEX "closing_records_month_idx" ON "course_closing_records" USING btree ("closing_month" text_ops);--> statement-breakpoint
CREATE INDEX "closing_records_student_idx" ON "course_closing_records" USING btree ("student_id" text_ops,"closing_month" text_ops);--> statement-breakpoint
CREATE INDEX "availability_selection_slot_idx" ON "teacher_availability_profile_selections" USING btree ("day_key" text_ops,"slot_id" text_ops);--> statement-breakpoint
CREATE INDEX "availability_requests_status_idx" ON "teacher_availability_change_requests" USING btree ("status" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "notifications_student_idx" ON "notifications" USING btree ("student_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("student_id" text_ops) WHERE (is_read = false);--> statement-breakpoint
CREATE INDEX "admin_notifications_unread_idx" ON "admin_notifications" USING btree ("created_at" timestamptz_ops) WHERE (is_read = false);--> statement-breakpoint
CREATE INDEX "admin_notification_failures_parent_idx" ON "admin_notification_failures" USING btree ("admin_notification_id" text_ops);--> statement-breakpoint
CREATE INDEX "zalo_notifications_class_idx" ON "zalo_notifications" USING btree ("class_id" date_ops,"notification_date" text_ops);--> statement-breakpoint
CREATE INDEX "zalo_notifications_failed_idx" ON "zalo_notifications" USING btree ("created_at" timestamptz_ops) WHERE (status = 'failed'::text);--> statement-breakpoint
CREATE INDEX "zalo_notifications_student_idx" ON "zalo_notifications" USING btree ("student_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "zalo_notifications_type_idx" ON "zalo_notifications" USING btree ("type" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "zalo_bot_link_codes_live_idx" ON "zalo_bot_link_codes" USING btree ("expires_at" timestamptz_ops) WHERE (consumed_at IS NULL);--> statement-breakpoint
CREATE INDEX "zalo_bot_link_codes_staff_idx" ON "zalo_bot_link_codes" USING btree ("staff_id" text_ops,"issued_at" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "zalo_bot_daily_digest_key" ON "zalo_bot_messages" USING btree ("staff_id" date_ops,"digest_date" date_ops,"message_type" text_ops) WHERE (message_type = 'daily_digest'::text);--> statement-breakpoint
CREATE INDEX "zalo_bot_messages_staff_idx" ON "zalo_bot_messages" USING btree ("staff_id" date_ops,"digest_date" date_ops);--> statement-breakpoint
CREATE INDEX "zalo_bulk_jobs_class_idx" ON "zalo_bulk_jobs" USING btree ("class_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "zalo_bulk_job_items_job_idx" ON "zalo_bulk_job_items" USING btree ("job_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action" timestamptz_ops,"occurred_at" text_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_table" text_ops,"entity_id" text_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_brin" ON "audit_logs" USING brin ("occurred_at" timestamptz_minmax_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("created_at" timestamptz_ops) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));--> statement-breakpoint
CREATE INDEX "print_requests_status_idx" ON "print_requests" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "enrollment_journal_run_idx" ON "student_enrollment_migration_journal" USING btree ("run_id" text_ops);--> statement-breakpoint
CREATE INDEX "outbox_jobs_ready_idx" ON "outbox_jobs" USING btree ("next_run_at" timestamptz_ops) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));--> statement-breakpoint
CREATE VIEW "public"."allowed_teachers" AS (SELECT email, role, added_at, added_by_admin FROM staff_email_access WHERE status = 'allowed'::text);--> statement-breakpoint
CREATE VIEW "public"."blocked_teachers" AS (SELECT email, blocked_at, blocked_by FROM staff_email_access WHERE status = 'blocked'::text);--> statement-breakpoint
CREATE VIEW "public"."v_class_current_term" AS (SELECT DISTINCT ON (class_id) class_id, id AS term_id, course_id, name AS term_name, term_start, term_end, tuition_fee, currency, start_time, days_of_week, term_end IS NULL OR term_end >= CURRENT_DATE AS is_open FROM class_terms t ORDER BY class_id, term_start DESC);--> statement-breakpoint
CREATE VIEW "public"."v_class_term_student_counts" AS (SELECT class_id, term_start, count(*) AS total, count(*) FILTER (WHERE status = 'active'::text) AS active, count(*) FILTER (WHERE status = 'trial'::text) AS trial, count(*) FILTER (WHERE status = 'on_leave'::text) AS on_leave, count(*) FILTER (WHERE status = 'dropped'::text) AS dropped, count(*) FILTER (WHERE status = 'completed'::text) AS completed, count(*) FILTER (WHERE status = 'transferred'::text) AS promoted FROM student_course_enrollments e GROUP BY class_id, term_start);--> statement-breakpoint
CREATE VIEW "public"."v_class_student_counts" AS (SELECT c.id AS class_id, COALESCE(n.total, 0::bigint) AS total, COALESCE(n.active, 0::bigint) AS active, COALESCE(n.trial, 0::bigint) AS trial, COALESCE(n.on_leave, 0::bigint) AS on_leave, COALESCE(n.dropped, 0::bigint) AS dropped, COALESCE(n.completed, 0::bigint) AS completed, COALESCE(n.promoted, 0::bigint) AS promoted FROM classes c LEFT JOIN v_class_current_term ct ON ct.class_id = c.id LEFT JOIN v_class_term_student_counts n ON n.class_id = c.id AND n.term_start = ct.term_start);--> statement-breakpoint
CREATE VIEW "public"."v_ledger_totals" AS (SELECT l.id AS ledger_id, COALESCE(sum(a.amount), 0::numeric) AS paid_total, COALESCE(sum(a.discount_amount), 0::numeric) AS discount_total, COALESCE(sum(a.sibling_discount_amount), 0::numeric) AS sibling_discount_total, l.amount - COALESCE(sum(a.amount), 0::numeric) - COALESCE(sum(a.discount_amount), 0::numeric) AS outstanding, count(a.id) AS allocation_count FROM course_fee_ledgers l LEFT JOIN receipt_allocations a ON a.ledger_id = l.id LEFT JOIN receipts r ON r.id = a.receipt_id AND r.status = 'posted'::text WHERE a.id IS NULL OR r.id IS NOT NULL GROUP BY l.id, l.amount);--> statement-breakpoint
CREATE VIEW "public"."v_student_wallet_balance" AS (SELECT s.id AS student_id, COALESCE(w.opening_balance, 0::numeric) + COALESCE(sum( CASE t.type WHEN 'deposit'::text THEN t.amount WHEN 'credit'::text THEN t.amount WHEN 'allocation'::text THEN - t.amount WHEN 'refund'::text THEN - t.amount WHEN 'adjustment'::text THEN CASE WHEN t.direction = 'out'::text THEN - t.amount ELSE t.amount END ELSE NULL::numeric END), 0::numeric) AS balance, COALESCE(w.opening_balance, 0::numeric) AS opening_balance, w.history_started_at, count(t.id) AS posted_transaction_count FROM students s LEFT JOIN student_wallets w ON w.student_id = s.id LEFT JOIN wallet_transactions t ON t.student_id = s.id AND t.status = 'posted'::text GROUP BY s.id, w.opening_balance, w.history_started_at);--> statement-breakpoint
CREATE VIEW "public"."v_student_current_enrollment" AS (SELECT e.student_id, e.id AS enrollment_id, e.class_id, c.teacher_id, e.term_start, e.term_end, e.status, e.joined_at FROM student_course_enrollments e JOIN classes c ON c.id = e.class_id WHERE e.status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text]));--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_accounting_student_summary" AS (SELECT s.id AS student_id, s.code AS student_code, s.name AS student_name, s.name_normalized AS student_name_normalized, s.student_lifecycle, cur.class_id AS current_class_id, cur.enrollment_id AS current_enrollment_id, cur.status AS current_enrollment_status, COALESCE(agg.class_count, 0::bigint) AS class_count, COALESCE(agg.course_count, 0::bigint) AS course_count, COALESCE(agg.total_paid, 0::numeric) AS total_paid, COALESCE(agg.total_outstanding, 0::numeric) AS total_outstanding, COALESCE(agg.overdue_course_count, 0::bigint) AS overdue_course_count, COALESCE(wb.balance, 0::numeric) AS wallet_balance, COALESCE(nl.reminder_count, 0::bigint) AS tuition_reminder_count, nl.last_reminder_at, now() AS rebuilt_at FROM students s LEFT JOIN LATERAL ( SELECT e.class_id, e.id AS enrollment_id, e.status FROM student_course_enrollments e WHERE e.student_id = s.id AND (e.status = ANY (ARRAY['trial'::text, 'active'::text, 'on_leave'::text])) ORDER BY e.term_start DESC LIMIT 1) cur ON true LEFT JOIN LATERAL ( SELECT count(DISTINCT l.class_id) AS class_count, count(*) AS course_count, sum(vt.paid_total) AS total_paid, sum(GREATEST(vt.outstanding, 0::numeric)) AS total_outstanding, count(*) FILTER (WHERE (l.status = ANY (ARRAY['unpaid'::text, 'partial'::text])) AND l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE) AS overdue_course_count FROM course_fee_ledgers l JOIN v_ledger_totals vt ON vt.ledger_id = l.id WHERE l.student_id = s.id) agg ON true LEFT JOIN v_student_wallet_balance wb ON wb.student_id = s.id LEFT JOIN LATERAL ( SELECT count(*) AS reminder_count, max(n.sent_at) AS last_reminder_at FROM ledger_notice_log n JOIN course_fee_ledgers l2 ON l2.id = n.ledger_id WHERE l2.student_id = s.id) nl ON true);--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_admin_class_tuition_summary" AS (SELECT l.class_id, l.term_start, count(*) AS ledger_count, sum(l.amount) AS total_amount, sum(vt.paid_total) AS total_paid, sum(vt.discount_total) AS total_discount, sum(GREATEST(vt.outstanding, 0::numeric)) AS total_outstanding, count(*) FILTER (WHERE l.status = 'paid'::text) AS paid_count, count(*) FILTER (WHERE l.status = 'partial'::text) AS partial_count, count(*) FILTER (WHERE l.status = 'unpaid'::text) AS unpaid_count, count(*) FILTER (WHERE l.status = 'waived'::text) AS waived_count, now() AS rebuilt_at FROM course_fee_ledgers l JOIN v_ledger_totals vt ON vt.ledger_id = l.id WHERE l.term_start IS NOT NULL GROUP BY l.class_id, l.term_start);
*/