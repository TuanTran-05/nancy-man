# Course-closing Query Client Fix Design

## Problem

Opening `/course-closing-records` crashes with:

`No QueryClient set, use QueryClientProvider to set one`

The course-closing feature uses TanStack Query hooks, but the production
application tree does not provide a `QueryClient`. Feature-level tests hide
this integration gap because they create their own `QueryClientProvider`.

## Scope

- Provide one stable TanStack Query client to all pages rendered by `App`.
- Restore the course-closing records page without changing its data-fetching
  behavior, API paths, authorization, or UI.
- Add an integration regression test that fails when a routed child cannot
  access the application Query Client.

## Design

Create one `QueryClient` at module scope in `src/App.tsx`. Wrap the existing
router with `QueryClientProvider`, keeping the current provider order and route
tree otherwise unchanged.

Module scope prevents a new client from being created during React rerenders.
Placing the provider in `App` makes the contract visible to tests that render
the application directly, while also covering every lazy-loaded route in
production.

## Alternatives Considered

- `src/main.tsx`: technically valid in production, but direct `App` tests could
  omit the provider again and miss the same integration regression.
- Course-closing route only: fixes the immediate crash but creates a local
  provider and does not establish the dependency for future Query-based pages.

## Error Handling

Existing React Query hook error states and the application error boundary remain
unchanged. This fix supplies the missing context rather than suppressing the
runtime exception.

## Testing

1. Add an `App` integration test whose mocked routed content calls
   `useQueryClient` and renders only when the client is available.
2. Run that test before implementation and confirm it fails because no client
   is set.
3. Add the provider and confirm the test passes.
4. Run the course-closing tests, full typecheck, and production build.

## Success Criteria

- `/course-closing-records` no longer throws the missing Query Client error.
- All routed descendants of `App` can access the same Query Client.
- Existing course-closing behavior and application tests remain green.
