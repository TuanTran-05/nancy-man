# Variables guarded apply and rollback

This runbook is an operational gate, not permission to enable production writes.
Keep all mutation `OPS_VARIABLES_*` flags false until the corresponding
injected-failure drill has passed.

The approved flow is: create one-application draft, validate against the displayed
source fingerprints, save the encrypted staged envelope, reauthenticate with the
current password and TOTP, then apply. The apply grant is bound to the change
digest, expires within five minutes, and is consumed before dispatch. A browser
disconnect does not cancel the agent run; reconnect with the change ID and status
stream.

Before enabling a strategy, complete the catalog review checklist and the
corresponding value-free failure drill. Keep `next_job`, runtime restart,
credential restart, and build/redeploy flags independent. Expected evidence is
the strategy, action/check IDs, and status transition; it never contains a
service command, environment body, or process environment.

Expected runtime evidence is limited to change/run IDs, state, sequence, action/check
IDs, fingerprints, digest, and reason codes. `next_job` means only that the next
scheduled run will observe the value; it does not mean that a job was executed.

Any write, action, timeout, or health failure must enter automatic rollback. Confirm
`ROLLED_BACK` and passing previous health before closing the change. A source
fingerprint conflict is a `409 CONFIG_SOURCE_CHANGED`: reload inventory and create a
replacement draft. There is no force-overwrite operation.

Do not inspect environment files, decrypted envelopes, snapshots, process
environments, request bodies, journal buffers, or command output. Record only the
value-free state and drill result.

## Safe disable

If the control plane is degraded, set draft/runtime/build flags to `false`, reload
the API, and leave encrypted evidence in place. Read-only inventory may remain
available independently.

For API/agent restart during a non-terminal apply, reconcile by change ID and
status before accepting another apply. For a rollback failure, use
[`ops-variables-rollback-failed.md`](ops-variables-rollback-failed.md); only an
owner with fresh `accounts_write` authorization may clear the block after the
Critical incident and declared health evidence are remediated.
