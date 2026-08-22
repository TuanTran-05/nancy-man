# Course-closing API Route Fix Design

## Problem

The course-closing records frontend sends actions as query parameters:

`/api/v1/classes?action=course-closing-record-month`

Vercel rewrites that URL to `/api/classes`, but the serverless entrypoint is
the dynamic route `api/classes/[action].ts`. The request therefore returns a
platform-level 404 before the authenticated handler runs.

Production verification confirms the routing boundary:

- Query-style URL returns Vercel `404 Not Found`.
- Path-style `/api/v1/classes/course-closing-record-month` reaches the handler
  and returns `401 Unauthorized` without credentials.

## Scope

Correct all three course-closing record client URLs:

- `course-closing-record-month`
- `course-closing-records`
- `course-closing-record-file`

Do not change server handlers, authorization, response contracts, query keys,
UI behavior, or Vercel function count.

## Design

Use the established dynamic-route contract:

`/api/v1/classes/<action>`

Action names move into the path. Data parameters remain encoded with
`URLSearchParams`:

- `/api/v1/classes/course-closing-record-month`
- `/api/v1/classes/course-closing-records?month=<month>&q=<search>`
- `/api/v1/classes/course-closing-record-file?recordId=<id>&documentType=<type>&mode=<mode>`

This matches existing classes API callers and allows the generic Vercel rewrite
to resolve `api/classes/[action].ts`.

## Alternatives

- Add a query-compatible rewrite: Vercel routing does not provide a clean,
  maintainable mapping from the `action` query value to a dynamic path.
- Add `api/classes.ts`: duplicates the existing action router, consumes another
  serverless entrypoint, and risks behavior drift.

## Testing

Add regression coverage at the query-hook boundary:

1. The month query calls the path-style month URL.
2. The records query calls the path-style records URL and preserves encoded
   `month` and optional `q`.
3. The file mutation calls the path-style file URL and preserves `recordId`,
   `documentType`, and `mode`.

Run the focused query/page tests, typecheck, and production build after the
red-green cycle.

## Success Criteria

- Authenticated production requests reach the classes handler instead of
  returning a Vercel routing 404.
- All three record endpoints use the same path-style action contract.
- Existing course-closing behavior remains unchanged beyond route resolution.
