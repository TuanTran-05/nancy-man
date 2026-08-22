# Strict DevTools Attempt During Student Assignment Design

## Goal

When a student is actively doing an assignment, DevTools attempts should behave
according to the assignment proctoring mode.

- In `strict` mode, the student must stay in the assignment modal. A DevTools
  attempt should increase the focus-loss count and show an in-assignment warning
  overlay with DevTools-specific copy.
- In `normal` mode, the existing `/blockdevtool` page should still appear, but
  its actions should return the student to the assignment instead of offering a
  dashboard escape.

## Current Context

The relevant current code paths are:

- `src/hooks/useBlockDevToolGuard.ts`
  - Captures `F12`, DevTools keyboard shortcuts, source-view shortcuts, and
    context menu.
  - Stores a return path in session storage.
  - Navigates to `/blockdevtool`.
- `src/app/BlockDevToolGuard.tsx`
  - Thin wrapper around `useBlockDevToolGuard`.
- `src/pages/common/BlockDevToolPage.tsx`
  - Shows the DevTools warning page.
  - Currently has `Quay lại Dashboard` and `Tôi đã hiểu`.
- `src/pages/common/Assignments.tsx`
  - Owns student assignment modal state.
  - Owns `submissionExamActive`, selected assignment, strict-mode detection,
    anti-cheat metrics, and integrity warning overlays.
- `src/hooks/useExamAntiCheat.ts`
  - Counts tab switches, focus loss, and fullscreen exits when strict mode is
    active.
- `src/components/assignments/SubmissionModal.tsx`
  - Renders the active assignment UI.
  - Renders warning overlays for tab/focus and fullscreen issues.

## Trigger Scope

The new behavior applies to every DevTools trigger already handled by
`useBlockDevToolGuard`:

- `F12`
- `Ctrl/Cmd + Shift + I/J/C/K`
- `Ctrl/Cmd + Alt + I/J/C/K`
- `Ctrl/Cmd + U`
- context menu

No new DevTools detection heuristics are added.

## Approved Behavior

### Strict Active Assignment

When all conditions are true:

- user role is `student`,
- submission modal is open,
- assignment attempt has started,
- selected assignment proctoring mode is `strict`,
- a DevTools trigger fires,

then the app should:

- prevent the browser/default DevTools action where possible,
- not navigate to `/blockdevtool`,
- increment `focusLossCount` by 1,
- update the combined focus-warning count used for strict-mode warnings,
- show an assignment overlay with DevTools-specific content:
  - title: DevTools access warning,
  - body: the student is trying to access DevTools during a strict assignment,
  - action: `Tôi đã hiểu` / `I understand`,
- keep the student inside the active assignment modal,
- preserve the existing auto-submit threshold behavior through the increased
  focus-loss count.

### Normal Active Assignment

When the student is actively doing an assignment whose proctoring mode is
`normal`, DevTools triggers should continue to navigate to `/blockdevtool`.

The block page should:

- store and use the current assignment route as the return path,
- not show a `Quay lại Dashboard` button,
- show a primary `Tiếp tục làm bài` button,
- make `Tôi đã hiểu` return to the same stored assignment path,
- fall back to `/` only when no safe return path exists.

### Outside Active Assignment

Existing behavior stays unchanged:

- non-admin users are routed to `/blockdevtool`,
- admin users still have the guard disabled by `App`,
- `/blockdevtool` remains reachable before login and after login,
- the block page fallback still works when there is no stored return path.

## Architecture

Use an event/callback bridge rather than duplicating DevTools shortcut detection
inside assignment code.

`useBlockDevToolGuard` remains the single owner of DevTools trigger detection.
It receives an optional interception callback. When a trigger fires, the hook
asks the callback whether the app handled the attempt. If the callback returns
`true`, the hook prevents default behavior and does not navigate. If it returns
`false` or is absent, the hook follows the existing `/blockdevtool` navigation
flow.

`Assignments` will provide the interception logic for active assignment attempts.
In strict mode, it manually records a focus-loss event and opens the new
`devtools` integrity overlay. In normal mode, it declines interception so the
global guard can navigate to `/blockdevtool`.

## Data Flow

1. Student starts an assignment.
2. `Assignments` knows whether the active attempt is strict or normal.
3. `BlockDevToolGuard` receives a callback from app-level active-attempt state.
4. Student presses a DevTools shortcut or opens context menu.
5. `useBlockDevToolGuard` detects the trigger.
6. In strict mode:
   - callback records a manual focus-loss event,
   - callback sets `integrityOverlay.kind = 'devtools'`,
   - hook does not navigate.
7. In normal mode:
   - callback returns `false`,
   - hook stores the current route,
   - hook navigates to `/blockdevtool`.
8. `/blockdevtool` returns the student to the stored route through both action
   buttons.

## Error Handling

- If session storage is unavailable, `/blockdevtool` still falls back to `/`.
- If no active assignment is registered, the guard uses its existing navigation.
- If a strict-mode DevTools attempt happens after auto-submit has started, the
  assignment state should not double-submit; existing auto-submit guard state in
  `Assignments` remains the source of truth.

## Testing

Use TDD and keep tests focused:

- `useBlockDevToolGuard.test.tsx`
  - callback intercept prevents navigation,
  - callback returning false preserves `/blockdevtool` navigation.
- `useExamAntiCheat.test.ts`
  - manual focus-loss recording increments `focusLossCount`.
- `SubmissionModal.test.tsx`
  - `devtools` overlay renders DevTools-specific copy and closes with the
    understood button.
- `Assignments.test.tsx`
  - strict active assignment DevTools trigger does not navigate and shows overlay,
  - normal active assignment DevTools trigger navigates to `/blockdevtool`.
- `BlockDevToolPage.test.tsx`
  - no Dashboard button,
  - `Tiếp tục làm bài` returns to stored path,
  - `Tôi đã hiểu` returns to stored path.

## Non-Goals

- Detecting DevTools window size gaps.
- Server-side storage of individual DevTools attempt events beyond the existing
  `examIntegrity` submission payload.
- Changing the strict-mode warning thresholds.
- Changing admin guard behavior.
- Replacing the current `/blockdevtool` visual design.

## Acceptance Criteria

- Strict active assignment plus DevTools trigger stays inside the assignment.
- Strict active assignment plus DevTools trigger increments `focusLossCount`.
- Strict active assignment plus DevTools trigger shows DevTools-specific overlay.
- Normal active assignment plus DevTools trigger reaches `/blockdevtool`.
- `/blockdevtool` no longer has a Dashboard escape button.
- `/blockdevtool` returns to the stored assignment route from both action
  buttons.
- Existing blockdevtool route tests still pass.
- Existing assignment submission, anti-cheat, typecheck, and build checks pass.
