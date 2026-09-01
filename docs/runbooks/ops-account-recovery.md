# Ops account recovery

For loss of the last usable owner or an offline additional-owner bootstrap,
follow [`ops-owner-loss-offline-recovery.md`](ops-owner-loss-offline-recovery.md).
For handling the one-time URL, follow
[`ops-enrollment-link-handling.md`](ops-enrollment-link-handling.md).

## Owner bootstrap

The first owner is created only through the offline bootstrap CLI on the Ops
host. The caller must have an interactive TTY and explicitly confirm the
operation. The command creates a `pending_mfa` owner and prints one single-use
MFA enrollment URL; it never prints a password or database URL.

If an active owner already exists, a second owner requires the explicit
`--additional-owner` option. There is no public registration or password-reset
endpoint.

## Recovery procedure

1. Verify the operator's identity through the out-of-band recovery process.
2. An existing `ops_owner` revokes all active sessions for the affected user.
3. Issue a new pending-MFA enrollment record and an audited, single-use URL.
4. Require a passkey or TOTP factor before returning the account to `active`.
5. Review login, MFA, session-revoke and recovery audit entries before closing
   the incident.
