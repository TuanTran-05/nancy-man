# Attendance Serverless Consolidation Design

## Goal

Reduce the Vercel serverless function entrypoints from 13 to at most 12 without changing the public teacher-attendance API used by the frontend.

## Context

The project is a Vite app deployed on Vercel with direct API files under `api/`. Vercel's runtimes documentation states that when using Vercel Functions directly without a framework, every API maps directly to one Vercel Function. The Node.js runtime documentation also states that files in the root `api` directory are built and served as functions.

Current local handler entrypoints:

- `api/admissions/[action].ts`
- `api/attendance/[action].ts`
- `api/audit/[action].ts`
- `api/auth/[action].ts`
- `api/classes/[action].ts`
- `api/edu/[action].ts`
- `api/finance/[action].ts`
- `api/knowledge-bank/[action].ts`
- `api/payments/payos/[action].ts`
- `api/read/[channel].ts`
- `api/students/[action].ts`
- `api/teacher-attendance/[action].ts`
- `api/zalo/[action].ts`

That makes 13 direct function entrypoints. The target is 12.

References:

- Vercel runtimes: https://vercel.com/docs/functions/runtimes
- Vercel Node.js runtime: https://vercel.com/docs/functions/runtimes/node-js

## Alternatives Considered

### Option A: Merge teacher-attendance mutations into attendance

Route `/api/v1/teacher-attendance/mark` is a single mutation in the attendance domain. Student attendance already lives at `api/attendance/[action].ts`; teacher attendance is session-level attendance and uses the same Firestore/audit/realtime primitives. Keeping the public URL through a rewrite avoids frontend churn.

This is the recommended option because it removes exactly one function with the smallest domain and auth surface.

### Option B: Merge payOS into finance

PayOS is related to finance, but it has webhook, gateway verification, review resolution, reconciliation, and cron paths. It also has different unauthenticated or secret-authenticated surfaces from normal finance actions. Merging it would raise blast radius for a one-function reduction.

### Option C: Create one catch-all API function

A catch-all dispatcher could reduce many functions, but it would combine unrelated auth, cron, webhook, read, finance, and class-management concerns. That is disproportionate to the current limit issue and would make incident isolation worse.

## Approved Design

Merge `api/teacher-attendance/[action].ts` into `api/attendance/[action].ts`.

Public route stays unchanged:

```text
POST /api/v1/teacher-attendance/mark
```

Add a specific Vercel rewrite before the generic `/api/v1/:path*` rewrite:

```json
{
  "source": "/api/v1/teacher-attendance/:action*",
  "destination": "/api/attendance/:action*?resource=teacher-attendance"
}
```

Inside `api/attendance/[action].ts`, dispatch teacher-attendance requests before the existing student-attendance auth/rate-limit path:

```typescript
const action = String(req.query.action || '');
const resource = String(req.query.resource || '');

if (resource === 'teacher-attendance') {
  const user = await verifyAuthToken(req, res, ['admin', 'office']);
  if (!user) return;
  const db = getDb();
  const role = await getUserRole(db, user.uid);

  if (action === 'mark') return await handleTeacherAttendanceMark(req, res, db, user.uid, role);
  return res.status(404).json({ success: false, error: 'Unknown teacher attendance action' });
}
```

Then keep the existing student-attendance flow unchanged for regular `/api/v1/attendance/*` requests.

## Behavior To Preserve

- Frontend continues calling `/api/v1/teacher-attendance/mark`.
- Teacher-attendance marking remains admin/office only.
- Student-attendance actions remain admin/teacher only.
- Teacher-attendance mark keeps current validation:
  - reject invalid payloads
  - reject future Vietnam dates
  - reject cancelled sessions
  - reject off-schedule non-makeup dates
  - preserve makeup status
  - prefer accepted substitute teacher over existing session/class teacher
- Audit log category remains `attendance_correction`.
- Realtime events remain `teacher-attendance`, `payroll`, and `level-management`.

## Testing Strategy

- Add a rewrite regression for `/api/v1/teacher-attendance/:action*`.
- Move the teacher-attendance route tests to the attendance handler and pass `resource=teacher-attendance` in query fixtures.
- Add a serverless-entrypoint count regression that asserts the project has exactly 12 default-export API handlers after removing `api/teacher-attendance/[action].ts`.
- Run targeted attendance, read, and UI tests that cover teacher-attendance behavior.
- Run typecheck and build after implementation.

## Out Of Scope

- No frontend endpoint rename.
- No payOS or finance route consolidation.
- No broad API catch-all refactor.
- No behavior changes to weekly teacher-attendance reads in `api/read/[channel].ts`.
