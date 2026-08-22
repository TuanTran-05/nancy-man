# Fix Sibling API Route Design

**Date:** 2026-07-22

## Problem

Selecting a student in the sibling relationship panel sends a request to
`/api/students?action=siblings`. The deployed application has no serverless
function at `/api/students`, so Vercel returns a platform-level `404` response
with `Content-Type: text/plain` and `x-vercel-error: NOT_FOUND`. The request
never reaches the student router or the sibling handler, and `apiRequest`
surfaces the non-JSON response in a toast.

The backend route already exists as the dynamic entrypoint
`api/students/[action].ts`. Other student mutations use the public v1 route
shape `/api/v1/students/<action>`, which the generic Vercel rewrite maps to
`/api/students/<action>`.

Production verification established the routing boundary:

- `/api/students?action=siblings` returns Vercel `404` as `text/plain`.
- `/api/v1/students/siblings` reaches the API function and returns JSON `401`
  without an authorization token.

## Goal

Make sibling link, unlink, and confirmed group-merge requests reach the
existing authenticated sibling API, and add focused regression coverage for
both the caller URL and the v1 rewrite contract.

## Selected Approach

Align the frontend call with the existing public API contract:

```text
SiblingSection
  -> POST /api/v1/students/siblings
  -> rewrite /api/v1/:path* to /api/:path*
  -> api/students/[action].ts, action = "siblings"
  -> verify admin or office role
  -> handleSiblings
  -> Firestore transaction, audit entry, realtime event
```

This is a caller-side route correction. The backend handler, validation
schema, Firestore transaction, audit behavior, and realtime notification are
already implemented and remain unchanged.

## Alternatives Considered

### Compatibility support for the incorrect URL

Adding a new `/api/students` entrypoint or a special rewrite would preserve
`/api/students?action=siblings`, but it would retain a route shape that does not
match the dynamic serverless entrypoint. A new entrypoint would also work
against the repository's serverless-function budget. This option is rejected.

### New sibling API abstraction

Moving the request behind new `linkSibling` and `unlinkSibling` functions in a
shared student API module would remove the URL literal from the component. It
adds an abstraction for a single call site without solving another current
need, so it is outside this focused fix. This option is rejected under YAGNI.

## Component Changes

### `src/components/students/SiblingSection.tsx`

Change the request path in `submit` from
`/api/students?action=siblings` to `/api/v1/students/siblings`.

Preserve all existing behavior:

- `POST` method.
- Object request body serialized by `apiRequest`.
- `link` payload with `studentId` and `siblingId`.
- `unlink` payload with `studentId`.
- Retry with `confirmMerge: true` after the user confirms a server `409`.
- Busy state, success and failure toasts, query reset, and `onChanged` refresh.

### `src/components/students/SiblingSection.test.tsx`

Update the endpoint assertion to `/api/v1/students/siblings`. The interaction
test remains responsible for verifying the method and object payload as well
as the endpoint. The merge-confirmation test continues to verify that the
second request contains `confirmMerge: true`.

The endpoint expectation must be changed before the component so that the
test fails against the current implementation and demonstrates the regression.

### `api/health-rewrite.test.ts`

Add a focused assertion that `vercel.json` contains the generic public API
rewrite exactly as configured:

```json
{
  "source": "/api/v1/:path*",
  "destination": "/api/:path*"
}
```

This complements the component assertion: one test locks the caller to the
public route, and the other locks the route mapping that delivers it to the
dynamic handler.

No `vercel.json` modification is required because the rewrite already exists.

## Error Handling

`apiRequest` remains the sole response parser. Once routing is corrected,
authentication, authorization, validation, merge confirmation, and handler
errors are JSON responses from the API rather than Vercel platform pages.

The existing `merge_confirmation_required` behavior remains unchanged:

1. The first request receives `409` from `handleSiblings` when two established
   sibling groups would be merged.
2. The component asks the user for confirmation.
3. On confirmation, the component repeats the same request with
   `confirmMerge: true`.

There is no fallback to the incorrect URL and no automatic retry for routing
errors because either behavior would hide a deployment or route regression.

## Testing Strategy

Implementation follows a focused TDD sequence:

1. Change the component test expectation to the public v1 endpoint.
2. Run the component test and confirm failure because the component still uses
   the query-style URL.
3. Change the component URL and confirm the component test passes.
4. Add the v1 rewrite assertion and confirm the route test passes against the
   existing configuration.
5. Run the sibling component test, Vercel rewrite test, and student action tests.
6. Run TypeScript type checking and the production build.

Verification commands:

```powershell
npx.cmd vitest run src/components/students/SiblingSection.test.tsx
npx.cmd vitest run api/health-rewrite.test.ts api/students/action.test.ts
npm.cmd run typecheck
npm.cmd run build
```

## Acceptance Criteria

- Linking a sibling sends `POST /api/v1/students/siblings` with an object body.
- Unlinking a sibling uses the same endpoint with the existing `unlink` payload.
- Confirmed sibling-group merges repeat the request with
  `confirmMerge: true`.
- The generic `/api/v1/:path*` rewrite is covered by an automated test.
- No backend handler, schema, authorization, Firestore, audit, realtime, or
  data-model behavior changes.
- Targeted tests, TypeScript type checking, and the production build pass.
- After deployment, sibling mutations receive JSON API responses and no longer
  receive Vercel `NOT_FOUND` responses.

## Non-Goals

- Auditing every frontend API call in the repository.
- Introducing a new API client abstraction.
- Supporting `/api/students?action=siblings` for backward compatibility.
- Changing sibling scholarship eligibility or sibling-group semantics.
- Changing production data or performing a migration.
