# Catalog change review checklist

Use this checklist for every catalog or manifest change. A catalog contains
metadata only: never paste a variable value, credential, decoded envelope,
process environment, or reversible fragment into the change, review, issue,
test snapshot, or evidence.

## Change record

- [ ] Change ID, author, reviewer, release ID, and UTC timestamp are recorded.
- [ ] The catalog version and manifest version are incremented deliberately;
      the expected catalog/manifest digest is recorded without raw content.
- [ ] The reason is value-free and names only the variable IDs, source IDs,
      application/function, and intended effect.
- [ ] The corresponding feature flag remains disabled until the deployment
      and failure-drill gates are complete.

## Variable metadata

For every added or changed entry:

- [ ] The identifier is valid, unique, and classified as `required`,
      `optional`, `unknown`, or `observed`.
- [ ] Visibility, editability, delete policy, sensitivity, and build/runtime
      effect are explicit.
- [ ] Source adapter, exact source ID, precedence rank, consumer references,
      and permitted action/check IDs are explicit.
- [ ] Required references are either present in the active source inventory or
      explicitly approved as a disabled feature; no unresolved required entry
      is hidden by an allowlist.
- [ ] PM2 literal entries are represented as `observed`; generated PM2
      internals, backup files, and host OS variables are excluded.
- [ ] Unknown and observed entries remain read-only in the catalog, API, agent,
      and UI. Required entries cannot be deleted; optional entries may be
      deleted only through the declared mutation policy.

## Source and consumer review

- [ ] The manifest path is exact, root-owned, regular, single-link, and has
      the declared owner, group, mode, and byte limit.
- [ ] The adapter round-trip test proves unchanged bytes, line endings,
      quoting, ordering, comments, trailing newline, ownership, and mode.
- [ ] Source fingerprints use the agent-only fingerprint key and disclose no
      raw or unkeyed content hash.
- [ ] Every consumer has a named effect and fixed action/health evidence;
      browser input cannot select a path, command, service, or check.
- [ ] The active source and compatible build-tooling commit are clean and
      resolved from the release, never from a mutable checkout.

## Verification and approval

- [ ] Catalog parser, coverage, manifest, API, agent, and UI tests pass.
- [ ] The value-free sentinel scan reports zero occurrences in PostgreSQL,
      audit, logs, metrics, traces, URLs, SSE, incidents, and browser storage.
- [ ] A second reviewer confirms the diff contains metadata and policy only.
- [ ] The signed review evidence contains counts, IDs, versions, digests,
      fingerprints, reason codes, and test result IDs only.
- [ ] Installation is staged with all write flags false; capability
      negotiation and read-only inventory pass before any flag change.

## Classification changes

To move an `unknown` or `observed` entry to `managed`, first add the exact
source, consumer, precedence, validation rule, write adapter, action/check,
rollback evidence, and retention policy. Run the full adapter and injected
failure drills, obtain owner approval, and publish a new manifest digest. A
classification change never makes a value visible in the catalog or review.

If any check fails, reject the change, leave the previous manifest active, and
keep all mutation flags disabled. Record only the failure reason and IDs.
