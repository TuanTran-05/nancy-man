# Current Class Display Fix

## Problem

The accounting student finance table renders `AccountingStudentSummary.currentClassId` directly in the “Lớp hiện tại” column. This exposes Firestore document IDs instead of a human-readable class name, even though `StudentFinanceWorkspace` already receives the class directory through its `classes` prop.

## Design

`StudentFinanceWorkspace` will resolve each non-null `currentClassId` against the supplied `classes` collection and render the matching class `name`. The lookup will be derived from the prop with `useMemo` so table rows do not repeatedly scan the class list.

If a row has no current class, or its class is absent from the supplied directory, the cell will render `—`. It will never fall back to exposing the internal document ID.

The API contract and accounting summary projection remain unchanged. Filtering continues to use class IDs, because those IDs are the correct stable keys for queries.

## Data Flow

1. `Finance` loads the class directory and passes it to `StudentFinanceWorkspace` through `classes`.
2. `StudentFinanceWorkspace` builds an `id -> name` lookup.
3. Each finance row uses `currentClassId` only as the lookup key.
4. The table displays the resolved class name or `—`.

## Error Handling

Missing or stale class-directory entries degrade to `—`. This avoids leaking implementation identifiers and does not block the rest of the finance table.

## Testing

Add a component regression test that supplies a class with ID `c1`, loads a student row whose `currentClassId` is `c1`, and verifies that:

- the class name is visible in the table;
- the raw class ID is not rendered in the current-class cell.

Run the focused Vitest file, then the project typecheck and build as final verification.

## Scope

This change is limited to current-class presentation in the accounting student finance workspace. It does not change projections, Firestore documents, API query behavior, or unrelated class displays.
