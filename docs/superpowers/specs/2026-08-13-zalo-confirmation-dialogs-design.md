# Zalo Confirmation Dialogs Design

**Date:** 2026-08-13

**Status:** Approved for specification

**Scope:** Admin Zalo OA manual-send confirmation and resend confirmation

## Design Read

This is a preserve-style redesign of a daily admin workflow. It should use the same display mechanism and neutral modal frame as EduTrack's create-class dialog, with predictable interaction patterns, restrained motion, and compact but readable information density. Zalo blue remains an action accent rather than becoming a colored modal header.

- Design variance: 3/10
- Motion intensity: 3/10
- Visual density: 6/10
- Foundation: existing React, Tailwind tokens, `ModalPortal`, `framer-motion`, and Lucide dependencies
- New third-party dependencies: none

## Problem

Two confirmation dialogs on the Admin Zalo OA page are implemented as page-local overlays:

1. The manual-send review dialog in `src/components/zalo/ZaloManualSendPanel.tsx`
2. The administrator resend dialog in `src/pages/admin/ZaloOA.tsx`

They do not consistently follow the modal patterns already used by EduTrack's Zalo confirmation dialogs. In particular, the manual-send dialog shown in the supplied screenshot has an unstructured text block, no portal, no scroll lock, no focus trap, no entrance or exit treatment, and no bounded scroll region for long template values. The resend dialog has similar infrastructure gaps and a separate visual structure.

## Goals

- Make both dialogs use the same presentation and interaction mechanism as `ClassFormModal`.
- Make both dialogs visibly part of the same Zalo confirmation family through their content, iconography, and primary action.
- Use one shared shell so the two dialogs cannot drift apart.
- Make long template values easy to scan without allowing the modal to leave the viewport.
- Preserve all existing sending, validation, notification, refresh, and localization behavior.
- Improve modal accessibility with proper dialog semantics, focus containment, focus restoration, and body scroll locking.
- Prevent accidental dismissal or duplicate submission while a send request is active.

## Non-goals

- Redesigning the Admin Zalo OA page, history table, filters, or manual-send form.
- Changing Zalo APIs, request payloads, template policies, or server behavior.
- Changing the existing minimum resend-reason rule.
- Creating a new application-wide dialog framework.
- Restyling unrelated modal components.

## Considered Approaches

### 1. Shared Zalo confirmation shell

Create a focused `ZaloActionDialog` component for both send confirmation flows.

Advantages:

- One source of truth for structure, accessibility, animation, and pending behavior.
- Keeps the abstraction narrow and avoids affecting unrelated dialogs.
- Makes future Zalo confirmation dialogs straightforward to add.

Trade-off:

- Introduces one new component and its tests.

**Decision:** Use this approach.

### 2. Duplicate the same classes in both call sites

This would be quick initially, but accessibility and visual behavior could diverge again. It also duplicates the most error-prone modal infrastructure.

### 3. Expand the global `ConfirmModal`

The existing global component is designed for a title, a short message, and two simple actions. Supporting dynamic template values, a reason textarea, and scrollable content would turn it into a broad compound component and risk unrelated consumers.

## Architecture

Add a focused shared component:

`src/components/zalo/ZaloActionDialog.tsx`

Its public contract will cover only the common dialog shell:

- open state
- title and optional description
- localized close, cancel, and confirm labels
- pending and confirm-disabled states
- close and confirm callbacks
- arbitrary body content supplied as children

The shell owns:

- `ModalPortal` with `lockScroll` and `trapFocus`
- dialog semantics and generated title/description IDs
- backdrop and content animation
- the common neutral header modeled on `ClassFormModal`
- the bounded, scrollable body region
- the common action row at the bottom of the scrollable content
- close protection while submitting
- the primary-action send icon and loading indicator

The two existing callers continue to own their domain state and network actions. No request logic moves into the shared component.

## Visual Design

### Shared shell

- Use the same root mechanism as `ClassFormModal`: `ModalPortal lockScroll trapFocus` around a full-screen `z-[1000]` centered layer with 16px viewport padding.
- Use the same slate overlay treatment: `bg-slate-900/40 backdrop-blur-sm`.
- Use the same content transition: opacity plus scale from `0.9` and a 20px vertical offset, with the existing reduced-motion safeguard applied.
- Use the same card geometry: semantic surface background, `rounded-2xl`, `shadow-2xl`, `w-full`, `max-w-lg`, `overflow-hidden`, `flex flex-col`, `max-h-[90vh]`, and `overscroll-contain`.
- Keep the header outside the scroll region and make the content region `overflow-y-auto overscroll-contain flex-1`.

### Header

- Match the create-class modal header: semantic surface background, 24px padding, bottom border, title on the left, and close control on the right.
- Use primary heading text rather than a colored header block.
- Give the close control the same rounded hover treatment and a localized accessible label.

### Body

- Semantic surface colors so light and dark themes remain consistent.
- Labels use subdued text and values use the primary heading color.
- Long values use `break-words` and preserve intentional line breaks.
- Spacing, not a border under every value, separates variable groups.

### Actions

- Place the action row after the dialog-specific content, matching the create-class form structure.
- Use top spacing rather than a separate colored or sticky footer.
- Use two equal-width actions.
- Neutral cancel/back action and blue primary confirm action.
- Primary action displays a spinner during submission.
- Buttons remain on one line at supported mobile widths.

## Manual-send Confirmation Content

The manual-send dialog remains the final review step before calling `sendZaloManualMessage`.

The body displays:

1. Template name
2. Recipient phone number
3. Template variables in the exact order defined by `detail.listParams`

Each variable is rendered as a label and value pair. Empty optional values display a neutral placeholder rather than disappearing. Long feedback fields such as `good` and `bad` wrap naturally inside the scrollable body.

Actions:

- Back closes the review and returns to the populated manual-send form.
- Confirm sends the exact existing payload.
- While sending, close, back, and confirm are disabled.
- A failed request keeps the dialog, phone, and variable values intact for retry.
- A successful request closes and resets the composer, shows the existing success toast, and refreshes history through `onSent`.

## Resend Confirmation Content

The resend dialog remains the approval step before calling `resendZaloHistoryEntry`.

The body displays:

1. Notification type and recipient
2. Available recipient phone or template context from the selected history entry
3. The existing warning that previous-send and short deduplication locks are bypassed
4. The localized resend-reason textarea

Actions:

- Cancel closes the dialog and clears the draft reason.
- Confirm remains disabled until the trimmed reason has at least three characters.
- While resending, close, cancel, and confirm are disabled.
- A failed request keeps the dialog and reason intact for retry.
- A successful request closes and resets the dialog, shows the existing success toast, and reloads history.

## Interaction and Accessibility

- The dialog uses `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
- Optional descriptive text is connected with `aria-describedby`.
- `ModalPortal` traps focus while open and restores focus to the launching control after close.
- `ModalPortal` locks body and registered scroll containers while open.
- The backdrop is visual only and does not close the dialog, matching the repository's current accidental-dismissal policy.
- The explicit close and secondary action controls are the dismissal paths.
- All icon-only controls have localized accessible labels.
- Pending state prevents closing and duplicate requests.
- Motion is limited to opacity, scale, and vertical transform. Reduced-motion users receive an instant or opacity-only transition through the existing motion-safety hook.

## State and Data Flow

### Manual send

1. The user completes the existing template form.
2. Review opens with the current `detail`, `phone`, and `values` state.
3. The shared dialog renders the review content without copying or transforming the outgoing payload.
4. Confirm calls the existing `confirmSend` handler.
5. Success resets state and invokes `onSent`; failure preserves review state.

### Resend

1. The user selects a resendable history entry.
2. `resendTarget` opens the shared dialog and `resendReason` starts empty.
3. Confirm validates the existing trimmed three-character minimum.
4. The existing `confirmResend` handler submits the target ID and trimmed reason.
5. Success resets state and reloads history; failure preserves the target and reason.

## Testing Strategy

Implementation follows test-first development.

### Shared dialog tests

- Renders through a portal with accessible dialog labeling.
- Locks scroll and traps/restores focus through `ModalPortal` integration.
- Does not dismiss from backdrop interaction.
- Calls close and confirm from their explicit controls.
- Disables dismissal and submission controls while pending.
- Uses reduced-motion-safe rendering.

### Manual-send integration tests

- Opens the shared dialog only after the form is valid.
- Shows template, phone, and ordered template variables.
- Preserves long text values in the review.
- Sends the unchanged payload once.
- Keeps the dialog populated after an API failure.
- Resets and invokes `onSent` after success.

### Resend integration tests

- Opens the shared dialog for the selected history entry.
- Keeps confirm disabled for a reason shorter than three trimmed characters.
- Sends the existing history ID and trimmed reason once.
- Keeps the dialog and reason after an API failure.
- Closes, resets, and reloads history after success.

### Verification

- Run the focused Vitest suites for the shared dialog, manual-send panel, and Admin Zalo OA page.
- Run TypeScript type checking.
- Run Prettier verification for changed TypeScript and TSX files.
- Run the production build after focused tests pass.
- Perform a visual check at desktop and narrow mobile widths in both supported themes.

## Acceptance Criteria

- Both confirmation dialogs share the same header, container, body, action row, animation, and accessibility infrastructure.
- Both dialogs use the same portal, overlay, card geometry, scrolling behavior, and neutral header pattern as `ClassFormModal`.
- Both dialogs retain Zalo identity through content and the blue send action without introducing a colored header.
- Long manual template content remains readable, the modal remains inside the viewport, and the actions remain reachable within the bounded scroll region.
- The body behind an open dialog cannot scroll.
- Keyboard focus remains inside the dialog and returns to the launcher after close.
- Backdrop clicks do not dismiss either dialog.
- No close or duplicate-send action is possible during a pending request.
- Existing send/resend payloads, validation rules, toast behavior, and history refresh behavior remain unchanged.
- Light theme, dark theme, desktop, and mobile layouts remain usable.
