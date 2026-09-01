# Owner loss and offline additional-owner recovery

This procedure is for loss of the last usable canonical owner, compromise of
all owner sessions, or a recovery exercise. It requires a named incident,
verified backup/recovery access, and a root-owned interactive TTY on the Ops
host. It never uses the public application to create or reset an owner.

## Safety gate

1. Open a value-free incident and record only the recovery ID, operator ID,
   release ID, and reason code.
2. Put account mutations and all Variables write/apply flags in their safe
   disabled state. Read-only inventory may remain enabled independently.
3. Confirm the target host, database, and release are the approved recovery
   targets. Do not copy sessions, password hashes, TOTP secrets, or enrollment
   URLs from a backup into a live browser.
4. Confirm the latest backup and the isolated restore procedure are healthy.
   If backup integrity or database identity is uncertain, stop and escalate.

## Offline additional-owner bootstrap

Run the release's offline bootstrap entrypoint as `root` from the verified
release directory with an interactive TTY and explicit confirmation. The
entrypoint must call the `bootstrapOwner` service with `additionalOwner=true`
when an active owner exists, use the PostgreSQL owner-bootstrap repository,
and use the configured HTTPS public URL. It must print the single enrollment
URL exactly once to the attached terminal and must not print a password,
database URL, token hash, secret, or SQL result.

For the packaged release, the invocation is:

```sh
cd -- "$(readlink -f /srv/edutrack-ops/current)"
sudo env \
  OPS_SECRET_DIRECTORY=/run/credentials/edutrack-ops-api.service \
  node --env-file=/etc/edutrack-ops/api.env \
  dist/apps/api/src/cli/bootstrapOwnerCommand.js --additional-owner
```

Run it from a real TTY; do not redirect or pipe the prompts. The command
prompts for the username, email, display name, explicit `CREATE OWNER`
confirmation, and two hidden password entries. Omit `--additional-owner`
only when the verified precondition is that no active owner exists.

The resulting account is `pending_mfa`, has a newly generated password
credential, and receives a single-use enrollment token with a 24-hour expiry.
Deliver the URL through the approved out-of-band channel and follow
[`ops-enrollment-link-handling.md`](ops-enrollment-link-handling.md). Never
put it in shell history, a ticket, chat transcript, log, screenshot, or
browser storage.

The bootstrap must refuse to proceed without explicit TTY confirmation and
must refuse a second owner unless the explicit additional-owner option is
present. Verify the result with counts and IDs only, then complete password
and TOTP enrollment before restoring the account to active service.

## Post-recovery controls

- Revoke every session and pending challenge associated with the affected
  owner or compromised recovery window.
- Review account-event IDs for bootstrap, recovery, activation, revocation,
  and session invalidation. Do not export event metadata that contains
  credentials or tokens.
- Have the recovered owner create and enroll a second owner before closing a
  last-owner incident. Verify final-owner protection and owner-only account
  administration under a transaction test.
- Restore read-only service first. Re-enable each write/apply flag only after
  its corresponding runbook and injected-failure drill has been signed off.
- If the bootstrap or enrollment fails, leave the account pending/revoked as
  appropriate, expire the link, keep all writes disabled, and open a new
  recovery reason code. Do not repair state with direct public SQL.

## Evidence

Record only the recovery ID, account ID, event IDs, status transitions,
expiry outcome, test IDs, and operator approvals. A reviewer must confirm that
the enrollment URL and all credential material are absent from database rows,
audit metadata, logs, metrics, traces, URLs, and persisted browser state.
