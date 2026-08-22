# Clickable Teacher Profile Class Cards

## Goal

Allow an administrator to open a teacher's assigned class directly from the teacher profile modal by clicking anywhere on the class card.

## Scope

- Update `StaffProfileModal` only.
- Use the existing class detail route, `/classes/:classId`.
- Do not change APIs, persisted data, permissions, or the class detail page.

## Interaction Design

- When an assigned class has an `id`, render its entire card as a React Router `Link` to `/classes/{id}`.
- Preserve the current class name, schedule, and date-range content.
- Add clear hover, active, and keyboard-focus states so the card visibly behaves as an interactive element.
- Route navigation unmounts the admin dashboard and therefore closes the modal naturally.
- When an assigned class has no `id`, retain the current non-interactive card so no invalid class URL can be opened.

## Accessibility

- Use a semantic link instead of a clickable `div`.
- Keep the full card keyboard reachable and show a visible focus ring.
- Give the link an accessible name derived from the displayed class name and content.

## Testing

- Render the modal inside a router and verify a class with an `id` is exposed as a link whose destination is `/classes/{id}`.
- Verify the schedule and date details remain inside the link, proving the whole card is clickable.
- Verify a class without an `id` remains visible but is not exposed as a link.
- Run the focused component test, TypeScript typecheck, and production build.

## Error Handling

No new asynchronous operation is introduced. Missing class identifiers are handled by rendering the existing static card instead of creating a broken link.
