# Task 6 Review Fix 1 Report

Base: `4623d6386369df521fefb3c68b80c6311663f7ec`

Implementation commit / head: `18033f1` (`fix(database): harden explorer role provisioning`)

Scope: Task 6 findings only. Task 7/8 and FullErd files were not changed.

## Findings, tests, and fixes

1. **Grant policy fields were not authenticated by the approved checksum.** Added CLI tests that preserve the approved checksum while changing blocked `password_hash` policy fields, and while changing a structural column type. Both assert failure, empty stdout, and no output file. The renderer now recomputes the canonical structural checksum and compares it to the snapshot checksum; it derives/validates classification and selectability with shared `classifyColumn`, then renders from that shared policy.

2. **Unexpected LOGIN memberships could retain privileges.** Added provisioning assertions for enumerating and revoking all direct memberships before the expected capability grant, and verifier mock coverage for unexpected membership through inherited/SET-reachable paths. Provisioning clears all direct memberships on the configured LOGIN and capability role, grants only `ops_database_browser` with `INHERIT TRUE, SET FALSE`, and verifies no other reachable role. The verifier checks the exact direct capability membership options and fails on any other reachable membership.

3. **Global default ACLs, including PUBLIC, were not handled.** Added static SQL tests for global table, sequence, and function revokes to PUBLIC, capability, and LOGIN, plus verifier mock coverage for unsafe ACL posture. Provisioning removes global defaults for configured and actual relevant schema owners, in addition to per-schema defaults. The verifier inspects `pg_default_acl` with `aclexplode`, including PUBLIC (OID 0), browser roles, relevant schemas/owners, and the built-in global PUBLIC function-execute default when no owner-level override exists. No sequence or function grant was added. Live object-creation/effective-privilege verification is deferred; see Risks.

4. **The shared capability could be provisioned for both targets on one cluster.** Added a deterministic SQL guard test. Provisioning takes a cluster-wide transaction advisory lock and rejects a target when the other target's LOGIN already has the singleton `ops_database_browser` capability, preserving the singular capability contract.

5. **Verifier identity/TLS checks were optional.** Added spawned-CLI tests for each missing required option and an apply-wrapper test that captures verifier arguments. The verifier now requires exact expected database, expected LOGIN role, and `--require-tls`; the apply wrapper defaults TLS enforcement on and passes it to verification.

## Verification

- RED evidence before implementation: `npx vitest run deploy/postgres/render-database-explorer-grants.test.ts deploy/postgres/verify-database-explorer-role.test.ts` — 9 failed, 14 passed, exposing the requested gaps.
- Focused Task 6 gate after implementation: `npx vitest run deploy/postgres scripts/database-explorer deploy/ops/env/sql-worker.env.example.test.ts deploy/ops/systemd/systemd-assets.test.ts` — 8 files passed, 54 tests passed.
- `git diff --check` — passed.
- `bash -n deploy/postgres/apply-role-grants.sh deploy/ops/scripts/install-systemd-assets.sh` — passed.
- Full `npm test` was not run, per scope instruction and the known unrelated FullErd gate.

## Risks and deferred checks

The role/default-ACL SQL was not applied to a live PostgreSQL cluster. `pg_isready` accepted the local endpoint, but `psql --dbname=postgres` failed with `FATAL: role deploy does not exist`; no alternate credentials were tried. SQL behavior is therefore covered by static SQL assertions and verifier query mocks, not an integration test proving newly created table/sequence/function effective ACLs. Run the live provisioning and post-provision default-ACL checks as a release gate when authorized database credentials are available.

The advisory-lock target guard assumes both target provisioning attempts reach the same PostgreSQL cluster and use this script. Default-off deployment behavior is unchanged.
