# Create Staff Modal Redesign

## Goal

Redesign the create staff account modal so it feels more polished and easier to scan while preserving the existing feature logic.

## Approved Direction

Use the "friendly guided" direction:

- Keep a light branded header with the modal title and live email preview.
- Replace the role select with three role cards for teacher, accounting, and level manager.
- Keep the existing email prefix plus role-based suffix behavior.
- Group staff details below the role picker.
- Make success, temporary password copy, and Zalo send status easier to read.

## Behavior To Preserve

- Reset form state whenever the modal opens.
- Compute email suffix from the selected role:
  - teacher: `.teacher@nancy.com`
  - accounting: `.accounting@nancy.com`
  - level manager: `.levelmanager@nancy.com`
- Submit the same payload to `/api/v1/auth/staff-create-account`.
- Send `managedLevel` only when role is `level_manager`.
- Validate Vietnamese phone numbers before submit.
- Normalize phone numbers before API/Zalo usage.
- Show the generated temporary password and copy it with the existing clipboard logic.
- Send staff credentials through Zalo when a normalized phone number exists.
- Preserve existing localized labels and error messages where possible.

## UI Notes

- Modal stays centered with the existing overlay behavior.
- Width can increase slightly from the current compact form to fit the role cards.
- On small screens, role cards and fields stack vertically.
- The submit button remains the primary action in the footer.
- The cancel and close actions keep the same `onClose` behavior.

## Verification

- Existing `CreateStaffModal` tests should still pass or be updated only for markup changes.
- Build/typecheck should pass.
