# Ops Variables local verification evidence

This is repository and disposable-fixture evidence captured on 2026-09-01
(Asia/Ho_Chi_Minh). It contains counts, IDs, state names, and reason codes
only. No password, token, variable value, decoded envelope, request body, or
credential material is recorded. It is not approval to enable production
writes.

## Gates

Ops repository:

- `npm test`: 219 test files passed, 1 skipped; 782 tests passed, 1 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors.
- `npm run build`: passed for every workspace.
- `npm run format:check`: passed.
- Playwright fixture run for `variables-readonly.spec.ts` and
  `variables-mutation.spec.ts`: 4 tests passed; fixture reported zero blocked
  external contacts.

Platform repository:

- `npm test`: 859 test files passed, 12 skipped; 6,590 tests passed, 67
  skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 3,285 warnings and zero errors.
- `npm run build`: passed, including the student identity architecture check.
- `npm run format:check`: passed.
- `npm run guard:document-store-retirement`: passed.

The Playwright fixture required user-space loading of the distribution's
Chromium libraries because the host image does not install them globally. No
system package or repository file was changed for that workaround.

## Acceptance-criteria evidence map

| Criterion | Automated evidence |
| --- | --- |
| Canonical owner/maintainer lifecycle | `apps/api/src/modules/auth/*test.ts`, `apps/api/src/modules/accounts/*test.ts`, `apps/api/src/cli/bootstrapOwner.test.ts`, `apps/api/src/cli/bootstrapOwnerCommand.test.ts`, `apps/api/src/cli/postgresOwnerBootstrapRepository.test.ts` |
| Legacy cookie is not trusted | `apps/web/src/web/App.test.tsx`, `scripts/ops/capture-public-contract.test.ts`, `apps/web/e2e/production-parity.spec.ts` |
| Step-up for every active Variables role | `apps/api/src/modules/variables/variablesRoutes.test.ts`, `apps/web/e2e/variables-readonly.spec.ts` |
| Complete metadata, duplicates, and precedence | `apps/config-agent/src/inventory/inventoryService.test.ts`, `apps/config-agent/src/adapters/*test.ts`, `apps/web/src/web/pages/VariablesPage.test.tsx`, `apps/web/e2e/variables-readonly.spec.ts` |
| Coverage of active definitions and consumers | `scripts/variables/catalogCoverage.test.ts`, `apps/config-agent/src/inventoryService.test.ts` |
| Required/unknown/observed mutation policy | `apps/web/src/web/components/VariableEditor.test.tsx`, `apps/api/src/modules/variables/configChangeService.test.ts`, `apps/config-agent/src/changes/validationService.test.ts` |
| Stale source conflict | `apps/api/src/modules/variables/configChangeService.test.ts`, `apps/config-agent/src/changes/validationService.test.ts` |
| No values or enrollment tokens in durable evidence | `apps/web/src/server/collector/redactor.test.ts`, `apps/config-agent/src/crypto/encryptedEnvelope.test.ts`, `apps/config-agent/src/changes/draftStore.test.ts`, `apps/config-agent/src/changes/snapshotStore.test.ts`, `apps/web/e2e/variables-readonly.spec.ts`, `apps/web/e2e/variables-mutation.spec.ts` |
| Runtime actions and health evidence | `apps/config-agent/src/changes/actionRunner.test.ts`, `apps/config-agent/src/changes/healthCheckRunner.test.ts`, `apps/config-agent/src/changes/runtimeHandlers.test.ts` |
| Clean-SHA config-derived build/redeploy | `deploy/ops/release-assets.test.ts`, `deploy/ops/release-manifest.test.ts`, platform release tests, `apps/web/e2e/variables-mutation.spec.ts` |
| Automatic rollback and rollback-failed block | `apps/config-agent/src/changes/applyCoordinator.test.ts`, `apps/config-agent/src/changes/applyStateMachine.test.ts`, `apps/config-agent/src/changes/changeRecovery.test.ts`, API incident/config-change tests |
| Owner-only account administration and last-owner protection | `apps/api/src/modules/accounts/accountRoutes.test.ts`, `apps/api/src/modules/accounts/accountService.test.ts`, `packages/db/src/accountAdministrationMigration.test.ts` |
| Enrollment, lock, rate-limit, revoke, and step-up lifecycles | `packages/security/src/mfa/enrollmentToken.test.ts`, `apps/api/src/modules/auth/*test.ts`, `apps/api/src/modules/accounts/*test.ts`, `apps/api/src/cli/bootstrapOwnerCommand.test.ts` |
| Independent read-only and mutation rollout gates | `apps/api/src/runtime/runtimeConfig.test.ts`, `apps/config-agent/src/runtimeConfig.test.ts`, `deploy/ops/systemd/systemd-assets.test.ts`, `apps/api/src/modules/variables/configChangeRoutes.test.ts` |

## Rollout posture

All four example flags remain `false`:

- `OPS_VARIABLES_READ_ONLY_ENABLED`
- `OPS_VARIABLES_DRAFT_ENABLED`
- `OPS_VARIABLES_RUNTIME_APPLY_ENABLED`
- `OPS_VARIABLES_BUILD_APPLY_ENABLED`

The runbooks in `docs/runbooks/` and the catalog checklist in
`docs/checklists/catalog-change-review.md` are the required approval gates for
any later staged deployment. Production mutation remains disabled until a
separate approved value-free failure-drill record exists.
