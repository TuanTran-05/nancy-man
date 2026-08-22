/**
 * Every way a student-linked record can change, named once.
 *
 * The maintenance window works by stopping writes to anything the migration
 * has already fingerprinted. A route missing from this list keeps writing
 * anyway: the merge then applies to a record that moved underneath it, which
 * surfaces as drift mid-cutover if anyone is watching and as a wrong balance
 * if nobody is.
 *
 * So the list is exhaustive by construction rather than by sampling, and the
 * accompanying test names every registered action. Adding a route without
 * deciding which side of the line it falls on fails that test.
 */

export type StudentIdentityMutationSurface =
  | 'students'
  | 'classes'
  | 'admissions'
  | 'attendance'
  | 'education'
  | 'finance'
  | 'payments'
  | 'student_auth'
  | 'messaging'
  | 'student_face'
  | 'audit_jobs';

export type StudentIdentityRouteDisposition = 'student_mutation' | 'read_only' | 'staff_only';

export type StudentIdentityMutationLookup = {
  surface: StudentIdentityMutationSurface;
  resource?: string;
  action: string;
  method: string;
};

export type StudentIdentityMutationRoute = StudentIdentityMutationLookup & {
  disposition: StudentIdentityRouteDisposition;
  /**
   * True when the route can bring a *new* student reference into existence.
   */
  createsStudentReference: boolean;
};

function route(
  surface: StudentIdentityMutationSurface,
  action: string,
  options: {
    method: string;
    resource?: string;
    disposition?: StudentIdentityRouteDisposition;
    creates?: boolean;
  }
): StudentIdentityMutationRoute {
  return {
    surface,
    resource: options.resource,
    action,
    method: options.method.toUpperCase(),
    disposition: options.disposition ?? 'student_mutation',
    createsStudentReference: options.creates === true,
  };
}

/**
 * A route that reads under every verb. Use only where the handler itself
 * refuses the write methods, so the guard has nothing to protect.
 */
function readOnlyUnderAnyMethod(
  surface: StudentIdentityMutationSurface,
  action: string,
  resource?: string
): StudentIdentityMutationRoute[] {
  return ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) =>
    route(surface, action, { method, resource, disposition: 'read_only' })
  );
}

export function routeKey(input: {
  surface: string;
  resource?: string;
  action: string;
  method: string;
}): string {
  const prefix = input.resource
    ? `${input.surface}:${input.resource}:${input.action}`
    : `${input.surface}:${input.action}`;
  return `${prefix}:${input.method.toUpperCase()}`;
}

export const STUDENT_IDENTITY_MUTATION_INVENTORY: readonly StudentIdentityMutationRoute[] = [
  // --- students ---
  route('students', 'create', { method: 'POST', creates: true }),
  route('students', 'import', { method: 'POST', creates: true }),
  route('students', 'course-enrollment', { method: 'POST', creates: true }),
  route('students', 'transfer', { method: 'POST' }),
  route('students', 'update', { method: 'PUT' }),
  route('students', 'update-profile', { method: 'POST' }),
  route('students', 'status', { method: 'PUT' }),
  route('students', 'siblings', { method: 'POST' }),
  route('students', 'delete', { method: 'DELETE' }),
  route('students', 'standardize-student-ids', { method: 'POST' }),
  route('students', 'evaluation-insights', { method: 'GET', disposition: 'read_only' }),

  // --- classes ---
  route('classes', 'create', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'update', { method: 'PUT', disposition: 'staff_only' }),
  route('classes', 'import-students', { method: 'POST', creates: true }),
  route('classes', 'reset-course', { method: 'POST', creates: true }),
  route('classes', 'status', { method: 'PUT' }),
  route('classes', 'delete', { method: 'DELETE' }),
  route('classes', 'generate-ledgers', { method: 'POST', creates: true }),
  route('classes', 'rebuild-student-counts', { method: 'POST' }),
  route('classes', 'approve-course-closing', { method: 'POST' }),
  route('classes', 'exempt-course-closing-student', { method: 'POST' }),
  route('classes', 'update-salary', { method: 'PUT', disposition: 'staff_only' }),
  route('classes', 'save-settings', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'save-holidays', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'create-substitute-request', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'accept-substitute-request', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'cancel-substitute-request', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'save-availability', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'review-availability-change', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'save-availability-slot', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'cancel-print-request', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'update-print-request-status', { method: 'POST', disposition: 'staff_only' }),
  route('classes', 'course-closing-status', { method: 'GET', disposition: 'read_only' }),
  route('classes', 'course-closing-record-month', { method: 'GET', disposition: 'read_only' }),
  route('classes', 'course-closing-records', { method: 'GET', disposition: 'read_only' }),
  route('classes', 'course-closing-record-file', { method: 'GET', disposition: 'read_only' }),

  // --- admissions ---
  route('admissions', 'create-trial', { method: 'POST', creates: true }),
  route('admissions', 'add-to-waitlist', { method: 'POST', creates: true }),
  route('admissions', 'trial-decision', { method: 'POST' }),
  route('admissions', 'delete-pending', { method: 'POST' }),
  route('admissions', 'search-historical', { method: 'GET', disposition: 'read_only' }),
  route('admissions', 'list-pending', { method: 'GET', disposition: 'read_only' }),
  route('admissions', 'recent', { method: 'GET', disposition: 'read_only' }),

  // --- attendance ---
  route('attendance', 'mark', {
    method: 'POST',
    resource: 'teacher-attendance',
    disposition: 'staff_only',
  }),
  route('attendance', 'toggle', { method: 'POST' }),
  route('attendance', 'bulk-toggle', { method: 'POST' }),
  route('attendance', 'cycle', { method: 'POST' }),
  route('attendance', 'update-detail', { method: 'POST' }),
  route('attendance', 'toggle-permission', { method: 'POST' }),
  route('attendance', 'delete-record', { method: 'DELETE' }),
  route('attendance', 'delete-dates', { method: 'POST' }),

  // --- education ---
  route('education', 'assignment-answer-media-upload', { method: 'POST' }),
  route('education', 'assignment-attempt-draft-save', { method: 'POST' }),
  route('education', 'assignment-attempt-draft-clear', { method: 'POST' }),
  route('education', 'assignment-submit', { method: 'POST' }),
  route('education', 'assignment-create', { method: 'POST', creates: true }),
  route('education', 'assignment-update', { method: 'PUT' }),
  route('education', 'assignment-delete', { method: 'DELETE' }),
  route('education', 'assignment-grade', { method: 'POST' }),
  route('education', 'assignment-delete-submissions', { method: 'DELETE' }),
  route('education', 'assignment-media-upload', { method: 'POST' }),
  route('education', 'evaluation-create', { method: 'POST', creates: true }),
  route('education', 'evaluation-update', { method: 'PUT' }),
  route('education', 'evaluation-delete', { method: 'DELETE' }),
  route('education', 'evaluation-save-daily-report', { method: 'POST' }),
  route('education', 'evaluation-confirm-session', { method: 'POST' }),
  route('education', 'assignment-draft-save', { method: 'POST', disposition: 'staff_only' }),
  route('education', 'assignment-draft-delete', { method: 'DELETE', disposition: 'staff_only' }),
  route('education', 'assignment-draft-publish', { method: 'POST', creates: true }),
  route('education', 'assessment-question-bank-create', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('education', 'assessment-question-bank-submit-review', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('education', 'assessment-question-bank-review', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('education', 'assessment-media-bank-create', { method: 'POST', disposition: 'staff_only' }),
  route('education', 'assessment-question-bank-search', {
    method: 'GET',
    disposition: 'read_only',
  }),
  route('education', 'assessment-media-bank-search', { method: 'GET', disposition: 'read_only' }),
  route('education', 'get-quiz-answers', { method: 'GET', disposition: 'read_only' }),
  route('education', 'get-assessment-question-keys', { method: 'GET', disposition: 'read_only' }),
  route('education', 'assignment-draft-list', { method: 'GET', disposition: 'read_only' }),
  route('education', 'assignment-draft-get', { method: 'GET', disposition: 'read_only' }),
  route('education', 'assignment-draft-import-preview', {
    method: 'POST',
    disposition: 'read_only',
  }),
  route('education', 'assignment-draft-import-template', {
    method: 'GET',
    disposition: 'read_only',
  }),
  route('education', 'assignment-attempt-draft-get', { method: 'GET', disposition: 'read_only' }),
  route('education', 'assignment-progress-summary', { method: 'GET', disposition: 'read_only' }),
  route('education', 'evaluation-generate-ai', { method: 'POST', disposition: 'staff_only' }),

  // --- finance ---
  route('finance', 'create', { method: 'POST', resource: 'receipts', creates: true }),
  route('finance', 'create-and-post', { method: 'POST', resource: 'receipts', creates: true }),
  route('finance', 'post', { method: 'POST', resource: 'receipts' }),
  route('finance', 'void', { method: 'POST', resource: 'receipts' }),
  route('finance', 'next-number', {
    method: 'GET',
    resource: 'receipts',
    disposition: 'staff_only',
  }),
  route('finance', 'create', { method: 'POST', resource: 'expenses' }),
  route('finance', 'create-and-post', { method: 'POST', resource: 'expenses' }),
  route('finance', 'post', { method: 'POST', resource: 'expenses' }),
  route('finance', 'void', { method: 'POST', resource: 'expenses' }),
  route('finance', 'next-number', {
    method: 'GET',
    resource: 'expenses',
    disposition: 'staff_only',
  }),
  route('finance', 'list', { method: 'GET', resource: 'invoices', disposition: 'read_only' }),
  route('finance', 'get', { method: 'GET', resource: 'invoices', disposition: 'read_only' }),
  route('finance', 'create', { method: 'POST', resource: 'invoices', creates: true }),
  route('finance', 'deposit-and-post', { method: 'POST', resource: 'wallet' }),
  route('finance', 'allocate-and-post', { method: 'POST', resource: 'wallet' }),
  route('finance', 'void', { method: 'POST', resource: 'wallet' }),
  route('finance', 'student-context', {
    method: 'GET',
    resource: 'wallet',
    disposition: 'read_only',
  }),
  route('finance', 'transactions', { method: 'GET', resource: 'wallet', disposition: 'read_only' }),
  route('finance', 'balances', { method: 'GET', resource: 'wallet', disposition: 'read_only' }),
  route('finance', 'save-tuition-record', { method: 'POST', disposition: 'staff_only' }),
  route('finance', 'save-tuition-config', { method: 'POST', disposition: 'staff_only' }),
  route('finance', 'auto-generate-tuition', { method: 'POST', disposition: 'staff_only' }),
  // Reporting endpoints never write a student record under any method, and
  // they answer a wrong method with their own 405. Registering every method as
  // read_only keeps the guard from turning that 405 into an unclassified-write
  // 500 — the fail-closed default still covers every route not listed here.
  ...readOnlyUnderAnyMethod('finance', 'report'),
  ...readOnlyUnderAnyMethod('finance', 'center-report'),
  ...readOnlyUnderAnyMethod('finance', 'center-report-details'),
  ...readOnlyUnderAnyMethod('finance', 'class-reconciliation-options'),
  ...readOnlyUnderAnyMethod('finance', 'class-reconciliation'),
  ...readOnlyUnderAnyMethod('finance', 'class-reconciliation-student'),

  // --- payments ---
  route('payments', 'create', { method: 'POST', creates: true }),
  route('payments', 'webhook', { method: 'POST' }),
  route('payments', 'status', { method: 'GET' }),
  route('payments', 'list', { method: 'GET', disposition: 'read_only' }),
  route('payments', 'reconcile', { method: 'GET' }),
  route('payments', 'reconcile', { method: 'POST' }),
  route('payments', 'resolve-review', { method: 'POST' }),

  // --- student auth ---
  route('student_auth', 'staff-config', { method: 'GET', disposition: 'read_only' }),
  route('student_auth', 'auto-create-profile', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'sync-login', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'change-password-complete', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'create-password-request', { method: 'POST', creates: true }),
  route('student_auth', 'log-reset', { method: 'POST' }),
  route('student_auth', 'approve', { method: 'POST' }),
  route('student_auth', 'reset', { method: 'POST' }),
  route('student_auth', 'reject-password-reset', { method: 'POST' }),
  route('student_auth', 'verify-student-login', { method: 'POST' }),
  route('student_auth', 'verify-current-password', { method: 'POST', disposition: 'read_only' }),
  route('student_auth', 'request-zalo-otp', { method: 'POST' }),
  route('student_auth', 'verify-zalo-otp', { method: 'POST' }),
  route('student_auth', 'reset-password-zalo', { method: 'POST' }),
  route('student_auth', 'request-profile-phone-otp', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'verify-profile-phone-otp', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'confirm-profile-phone-change', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('student_auth', 'verify-turnstile-login', { method: 'POST', disposition: 'read_only' }),
  route('student_auth', 'staff-login-rate-check', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-create-account', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-forgot-password', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-reset-password', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-approve-reset-request', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('student_auth', 'staff-reject-reset-request', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('student_auth', 'staff-add-email', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'lookup-student', { method: 'POST', disposition: 'read_only' }),
  route('student_auth', 'staff-remove-email', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-unblock-email', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-delete-account', { method: 'POST', disposition: 'staff_only' }),
  route('student_auth', 'staff-delete-blocked-email', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('student_auth', 'staff-standardize-teacher-ids', {
    method: 'POST',
    disposition: 'staff_only',
  }),
  route('student_auth', 'migrate-credentials', { method: 'POST' }),
  route('student_auth', 'verify-credential-migration', {
    method: 'POST',
    disposition: 'read_only',
  }),
  route('student_auth', 'retrieve-temp-password', { method: 'POST', disposition: 'staff_only' }),

  // --- messaging ---
  route('messaging', 'bulk-notification-job', { method: 'POST' }),
  route('messaging', 'status', { method: 'GET', disposition: 'read_only' }),
  route('messaging', 'notify-absence', { method: 'POST' }),
  route('messaging', 'notify-evaluation', { method: 'POST' }),
  route('messaging', 'notify-rank-achievement', { method: 'POST' }),
  route('messaging', 'notify-tuition-reminder', { method: 'POST' }),
  route('messaging', 'notify-tuition-notice', { method: 'POST' }),
  route('messaging', 'notify-staff-credentials', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'test', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'admin-manual-send', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'notify-payment-confirm', { method: 'POST' }),
  route('messaging', 'send-notification', { method: 'POST' }),
  route('messaging', 'send-message', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'mark-read', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'mark-notification-read', { method: 'POST' }),
  route('messaging', 'mark-all-notifications-read', { method: 'POST' }),
  route('messaging', 'create-conversation', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'repair-conversation', { method: 'POST', disposition: 'staff_only' }),
  route('messaging', 'zalo-send-count', { method: 'GET', disposition: 'read_only' }),
  route('messaging', 'zalo-send-count', { method: 'POST', disposition: 'read_only' }),
  route('messaging', 'zalo-log-summary', { method: 'GET', disposition: 'read_only' }),

  // --- student face & knowledge bank ---
  route('student_face', 'upload', { method: 'POST', disposition: 'staff_only' }),
  route('student_face', 'upload-print-request', { method: 'POST', disposition: 'staff_only' }),
  route('student_face', 'delete', { method: 'DELETE', disposition: 'staff_only' }),
  route('student_face', 'print-request-file', { method: 'GET', disposition: 'read_only' }),
  route('student_face', 'student-face-image', { method: 'GET', disposition: 'read_only' }),
  route('student_face', 'student-face-url', { method: 'GET', disposition: 'read_only' }),
  route('student_face', 'download', { method: 'GET', disposition: 'read_only' }),
  route('student_face', 'upload-student-face', { method: 'POST', creates: true }),
  route('student_face', 'upload-profile-image', { method: 'POST' }),

  // --- audit jobs ---
  ...[
    'outbox-process',
    'payment-reconcile',
    'finance-aggregate',
    'dashboard-aggregate',
    'notification-digest',
    'daily-maintenance',
    'zalo-bot-daily-digest',
  ].flatMap((action) => [
    route('audit_jobs', action, { method: 'GET' }),
    route('audit_jobs', action, { method: 'POST' }),
  ]),
  route('audit_jobs', 'cleanup', { method: 'GET', disposition: 'staff_only' }),
  route('audit_jobs', 'cleanup', { method: 'POST', disposition: 'staff_only' }),
];

const BY_KEY = new Map<string, StudentIdentityMutationRoute>();

for (const entry of STUDENT_IDENTITY_MUTATION_INVENTORY) {
  BY_KEY.set(routeKey(entry), entry);
}

export function classifyStudentIdentityRouteMutation(
  input: StudentIdentityMutationLookup
): StudentIdentityRouteDisposition | 'unclassified_write' {
  const method = String(input.method || '').toUpperCase();
  const entry = BY_KEY.get(routeKey({ ...input, method }));
  if (entry) return entry.disposition;

  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    ? 'read_only'
    : 'unclassified_write';
}

export function requiresStudentIdentityMutationGuard(
  input: StudentIdentityMutationLookup
): boolean {
  return classifyStudentIdentityRouteMutation(input) === 'student_mutation';
}

export function findStudentIdentityMutationRoute(
  surface: StudentIdentityMutationSurface,
  action: string,
  resource?: string,
  method = 'POST'
): StudentIdentityMutationRoute | null {
  return BY_KEY.get(routeKey({ surface, resource, action, method })) ?? null;
}
