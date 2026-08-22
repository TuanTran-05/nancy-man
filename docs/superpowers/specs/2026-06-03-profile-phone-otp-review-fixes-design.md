# Profile Phone OTP Review Fixes Design

## Goal

Fix two review findings in the authenticated profile phone Zalo OTP flow:

1. Phone confirmation must not commit `users.phone` if the required audit log cannot be written.
2. Zalo OTP tracking IDs must not become collision-prone when Firebase UIDs are long.

## Scope

This design applies only to the backend profile phone OTP flow in:

- `api/auth/handlers/profilePhoneOtp.ts`
- `api/auth/profile-phone-otp.test.ts`

No UI behavior changes are required.

## Finding 1: Audit Must Be Atomic With Phone Update

Current confirm behavior updates `users.phone` and deletes the pending OTP inside a transaction, then calls `writeCriticalAuditLog` after the transaction. If audit logging fails after the transaction commits, the API can return an error even though the phone number has already changed and the pending OTP has already been deleted.

The fix is to write the audit log inside the same Firestore transaction that updates the phone:

1. Create `auditRef = db.collection('audit_logs').doc()` before starting the transaction.
2. Inside the transaction:
   - read `users/{uid}`
   - read `profilePhoneOtps/{uid}`
   - validate the pending OTP is present, unexpired, and verified
   - update `users/{uid}.phone`
   - delete `profilePhoneOtps/{uid}`
   - write the audit document with `tx.set(auditRef, auditPayload)`
3. If any transaction write fails, Firestore aborts the whole transaction and no partial phone update is committed.

The audit payload must keep the existing masked metadata:

- `method: "zalo-otp-profile-phone-change"`
- `oldPhoneMasked`
- `newPhoneMasked`
- `role`

## Finding 2: Tracking ID Should Remain Unique And Short

Current tracking ID generation uses:

```ts
`profile_phone_${user.uid}_${Date.now()}`.slice(0, 48)
```

For long Firebase UIDs, the timestamp can be truncated, making repeated requests more collision-prone.

The fix is to add a helper:

```ts
function buildProfilePhoneOtpTrackingId(uid: string, now = Date.now()): string
```

It should:

- put the timestamp before the user-derived portion
- avoid exposing the full UID
- stay short enough for Zalo tracking IDs

Recommended format:

```text
profile_phone_<timestamp>_<uidHash12>
```

Where `uidHash12` is the first 12 hex characters of `sha256(uid)`.

## Testing

Add backend tests for:

- confirm success writes audit through `tx.set` inside the transaction
- transaction failure from audit write returns an error and does not report success
- tracking IDs include the timestamp and a hashed UID suffix even for a long UID
- tracking IDs for different timestamps are different

Existing profile phone OTP tests should continue to pass.

## Out Of Scope

- UI changes
- Zalo template changes
- Changes to the public forgot-password OTP flow
- Changing audit log schema globally
