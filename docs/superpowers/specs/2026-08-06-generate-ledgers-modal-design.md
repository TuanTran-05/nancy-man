# Generate Ledgers Modal Design

## Context

The accounting student workspace opens `GenerateLedgersDialog` when the user selects “Tạo công nợ”. The dialog currently renders its overlay directly inside the page with `z-50` and top alignment. Other finance dialogs render through `ModalPortal`, sit above the whole application at `z-[1000]`, center their content, lock body scrolling, and trap focus.

The ledger dialog's preview and apply workflow is correct and remains in scope. This change only standardizes how the dialog is presented and dismissed.

## Selected approach

Update `GenerateLedgersDialog` to follow the established finance modal pattern instead of introducing a new shared abstraction or forcing its complex content into `ConfirmModal`.

- Render the dialog through `ModalPortal` with focus trapping and body-scroll locking.
- Use the standard full-viewport `z-[1000]` centered container.
- Render a blurred, dark backdrop behind the dialog.
- Preserve the existing fixed header, independently scrolling content region, fixed footer, responsive width, and height limits.
- Keep the existing preview-on-open and apply-on-confirm data flow unchanged.

## Dismissal behavior

The user may close the dialog with the close button, the Escape key, or the backdrop while it is previewing, ready, done, or showing an error.

While the apply request is in flight, all dismissal paths are disabled. This prevents the user from hiding unfinished writes or missing partial-run errors. The existing successful close and partial-error behavior remains unchanged.

Escape handling must defer to a nested modal if more than one modal dialog is open, matching the behavior used by the receipt and wallet history dialogs.

## Accessibility

- Retain `role="dialog"`, `aria-modal="true"`, and the heading association.
- Trap keyboard focus inside the open dialog and restore the previous focus after it closes.
- Lock background scrolling while the dialog is mounted.
- Give the backdrop control an accessible close label while keeping it visually behind the dialog.
- Preserve keyboard-operable buttons and disabled states.

## Error and loading states

Preview loading, apply loading, preview errors, partial apply errors, and successful application continue to use the existing state machine. This presentation change does not alter API requests, progress reporting, preview contents, or ledger creation rules.

## Verification

Extend `GenerateLedgersDialog.test.tsx` before changing production code to cover:

- rendering the open dialog through a portal attached to `document.body`;
- the standard centered, full-viewport modal container and backdrop;
- closing with Escape when no nested dialog is present;
- closing by clicking the backdrop;
- blocking close-button, Escape, and backdrop dismissal while applying;
- retaining the existing preview, confirmation, scrolling-region, partial-error, and successful-apply behavior.

Run the focused dialog test first, then the related accounting tests, type checking, and the production build.

## Scope boundaries

This change does not redesign ledger preview content, change translations, modify ledger-generation APIs, create a new global modal component, or alter unrelated finance dialogs.
