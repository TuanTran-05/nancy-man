# Prevent Money Inputs From Changing on Mouse Wheel

## Problem

The class form renders salary per session and tuition fee as native `input[type="number"]` controls with a `step` of 1,000. When either input is focused, the browser changes its value when the user turns the mouse wheel. A user who finishes entering an amount and scrolls toward the save button can therefore save an unintended value.

## Scope

- Apply the behavior to both salary per session and tuition fee.
- Apply it in both create-class and edit-class modes because they share `ClassFormModal`.
- Preserve keyboard entry, native numeric validation, and normal form scrolling.
- Do not change other numeric inputs in the application.

## Design

Add the same wheel handler to the two monetary number inputs in `ClassFormModal`. When a wheel event reaches a focused monetary input, the handler blurs that input. Removing focus before the browser performs its native number-input wheel action prevents the amount from stepping up or down, while allowing the wheel event to continue scrolling the form normally.

The existing `onChange` handlers remain unchanged, so typing and other intentional edits continue updating `formData` as before.

## Verification

Extend `ClassFormModal.test.tsx` with a regression test that renders the finance fields, focuses each monetary input, dispatches a wheel event, and verifies:

- the affected input loses focus;
- `setFormData` is not called as a result of the wheel event;
- both salary and tuition fields receive the protection.

Run the focused component test, then the relevant typecheck and full test suite as practical.
