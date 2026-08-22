# Zalo Bot Capability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dormant, fail-closed foundation for a typed Zalo Bot capability registry, adaptive response pages, accounting staff links, feature gates, and privacy-safe metrics without enabling any new data read or mutation.

**Architecture:** Shared modules own the canonical role and capability vocabularies. Server-only modules own capability contracts, registry lookup, gate evaluation, response composition, and telemetry. Accounting can link to the bot, but explicit legacy-role boundaries keep the current chat and daily digest limited to `teacher`, `office`, and `admin` until a separately gated capability adapter is implemented.

**Tech Stack:** Node.js >= 22.22.0, TypeScript 5.8, Zod 4, Vitest 4, React 19, existing `DocumentStore` and Zalo Bot modules.

**Spec:** `docs/superpowers/specs/2026-08-22-zalo-bot-capability-registry-design.md`

## Global Constraints

- This plan implements only rollout slice 1, **Foundation**. Read parity, pending commands, attendance writes, office mutations, and finance mutations are separate slices.
- Deploy defaults remain fail-closed: registry `false`, write `false`, audience `none`, enabled role list empty when the variable is absent, and enabled capability list empty. `.env.example` keeps the approved `teacher,office,admin` role example, which still grants nothing while audience is `none`.
- No new capability is connected to `answerZaloBotChatMessage` in this plan.
- Accounting may create and manage a Zalo link, receive link confirmations and admin test messages, but must not receive the existing daily digest or use the legacy AI chat path.
- The existing `/link`, webhook, digest, five base intents, and 11 dormant admin intents retain their current behavior.
- Gemini receives no new data and gains no tool, database, registry, or mutation access.
- Adaptive response pages are deterministic and every page is at most 2,000 UTF-16 code units, matching the existing provider boundary.
- Feature-gate names, role names, capability names, and audience values reject unknown configuration instead of being ignored.
- Capability telemetry accepts only typed categorical fields; it must not accept staff IDs, chat IDs, question text, arguments, previews, result rows, phone numbers, or financial amounts.
- Do not add a route or Vercel Function.
- Do not write production environment values or secrets. Only document empty/safe defaults in `.env.example`.
- Use TDD for every task and commit after each independently passing deliverable.

## File Structure

| Path | Responsibility |
|---|---|
| `server/api/zalo-bot/chat/responseComposer.ts` | Pure conclusion-first response model and deterministic page splitting |
| `server/api/zalo-bot/chat/responseComposer.test.ts` | Response ordering, blank suppression, stable pagination, 2,000-character contract |
| `shared/zaloBotCapabilities.ts` | Canonical read/write capability names and runtime guards |
| `shared/zaloBotCapabilities.test.ts` | Uniqueness and mode contracts for the shared catalog |
| `server/api/zalo-bot/chat/capabilities/capabilityTypes.ts` | Typed actor, read capability, write capability, preview, and confirmed-command contracts |
| `server/api/zalo-bot/chat/capabilities/capabilityRegistry.ts` | Immutable registry construction and lookup with runtime validation |
| `server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts` | Duplicate, unknown-name, mode-mismatch, lookup, and stable-list tests |
| `server/api/zalo-bot/chat/capabilities/capabilityGates.ts` | Pure fail-closed evaluation of master, capability, role, audience, pilot, and write gates |
| `server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts` | Gate-order and audience tests |
| `server/api/zalo-bot/chat/capabilities/capabilityMetrics.ts` | Typed privacy-safe capability metric events and injectable sink |
| `server/api/zalo-bot/chat/capabilities/capabilityMetrics.test.ts` | Exact serialized metric shape and invalid-duration tests |
| `shared/zaloBot.ts` | Full linkable staff roles plus explicit legacy-chat and digest role subsets |
| `server/api/zalo-bot/config.ts` | Parse and expose capability configuration |
| `server/api/zalo-bot/routeHandler.ts` | Permit accounting self-link routes |
| `server/api/zalo-bot/linkHandlers.ts` | Include accounting in admin overview/link/test validation |
| `server/api/zalo-bot/chat/chatService.ts` | Preserve three-role legacy chat boundary |
| `server/api/zalo-bot/digestSources.ts` | Preserve three-role daily-digest boundary |
| `src/components/zalo/ZaloBotLinkCard.tsx` | Show self-link UI for all linkable staff roles |
| `.env.example` | Safe capability-gate defaults |
| `docs/zalo-bot-runbook.md` | Foundation behavior, pilot gates, and rollback instructions |

---

### Task 1: Add the adaptive response page composer

**Files:**
- Create: `server/api/zalo-bot/chat/responseComposer.ts`
- Create: `server/api/zalo-bot/chat/responseComposer.test.ts`
- Modify: `server/api/zalo-bot/chat/answerComposer.ts:1-20`
- Test: `server/api/zalo-bot/chat/answerComposer.test.ts`

**Interfaces:**
- Consumes: no new project interface.
- Produces: `ZALO_BOT_CHAT_MAX_TEXT`, `ZaloBotAdaptiveResponse`, `ZaloBotResponsePage`, and `composeAdaptiveZaloBotResponse(response)` for capability definitions and read adapters.

- [ ] **Step 1: Write failing tests for conclusion-first composition and deterministic pagination**

Create `server/api/zalo-bot/chat/responseComposer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ZALO_BOT_CHAT_MAX_TEXT,
  composeAdaptiveZaloBotResponse,
} from './responseComposer.js';

describe('composeAdaptiveZaloBotResponse', () => {
  it('puts the conclusion first and removes empty sections', () => {
    const pages = composeAdaptiveZaloBotResponse({
      conclusion: 'Bạn có 2 việc cần xử lý.',
      sections: [
        { heading: 'Điểm danh', lines: ['• 7A1: còn 2 học viên'] },
        { heading: 'Yêu cầu in', lines: [] },
      ],
      nextActions: ['Gửi “chi tiết 7A1” để xem thêm.'],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0].text.startsWith('Bạn có 2 việc cần xử lý.')).toBe(true);
    expect(pages[0].text).toContain('Điểm danh\n• 7A1: còn 2 học viên');
    expect(pages[0].text).not.toContain('Yêu cầu in');
    expect(pages[0].hasMore).toBe(false);
  });

  it('splits only on stable line boundaries and keeps every page within 2000 characters', () => {
    const lines = Array.from({ length: 180 }, (_, index) =>
      `• Dòng ${String(index + 1).padStart(3, '0')}: ${'x'.repeat(32)}`
    );
    const pages = composeAdaptiveZaloBotResponse({
      conclusion: 'Danh sách kết quả.',
      sections: [{ heading: 'Chi tiết', lines }],
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.text.length <= ZALO_BOT_CHAT_MAX_TEXT)).toBe(true);
    expect(pages[0]).toMatchObject({ index: 0, hasMore: true });
    expect(pages.at(-1)).toMatchObject({ hasMore: false });
    expect(pages.map((page) => page.text).join('\n')).toContain(lines.at(-1));
  });

  it('rejects an empty conclusion', () => {
    expect(() => composeAdaptiveZaloBotResponse({ conclusion: '   ' })).toThrow(
      'Zalo Bot response conclusion is required'
    );
  });
});
```

- [ ] **Step 2: Run the new test and confirm the module is missing**

Run:

```bash
npm test -- server/api/zalo-bot/chat/responseComposer.test.ts
```

Expected: FAIL because `./responseComposer.js` does not exist.

- [ ] **Step 3: Implement the pure response model and paginator**

Create `server/api/zalo-bot/chat/responseComposer.ts`:

```ts
/** Hard provider boundary used by Zalo Bot sendMessage. */
export const ZALO_BOT_CHAT_MAX_TEXT = 2000;
const PAGE_CONTENT_LIMIT = 1960;

export type ZaloBotResponseSection = {
  heading?: string;
  lines: readonly string[];
};

export type ZaloBotAdaptiveResponse = {
  conclusion: string;
  sections?: readonly ZaloBotResponseSection[];
  nextActions?: readonly string[];
};

export type ZaloBotResponsePage = {
  index: number;
  total: number;
  text: string;
  hasMore: boolean;
};

function splitLongLine(line: string): string[] {
  if (line.length <= PAGE_CONTENT_LIMIT) return [line];
  const chunks: string[] = [];
  for (let offset = 0; offset < line.length; offset += PAGE_CONTENT_LIMIT) {
    chunks.push(line.slice(offset, offset + PAGE_CONTENT_LIMIT));
  }
  return chunks;
}

function normalizeLines(response: ZaloBotAdaptiveResponse): string[] {
  const conclusion = response.conclusion.trim();
  if (!conclusion) throw new Error('Zalo Bot response conclusion is required');

  const groups: string[][] = [[conclusion]];
  for (const section of response.sections ?? []) {
    const lines = section.lines.map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    groups.push([...(section.heading?.trim() ? [section.heading.trim()] : []), ...lines]);
  }
  const actions = (response.nextActions ?? []).map((line) => line.trim()).filter(Boolean);
  if (actions.length > 0) groups.push(['Tiếp theo:', ...actions]);

  return groups.flatMap((group, index) => [
    ...(index === 0 ? [] : ['']),
    ...group.flatMap(splitLongLine),
  ]);
}

export function composeAdaptiveZaloBotResponse(
  response: ZaloBotAdaptiveResponse
): ZaloBotResponsePage[] {
  const logicalLines = normalizeLines(response);
  const contentPages: string[] = [];
  let current = '';

  for (const line of logicalLines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= PAGE_CONTENT_LIMIT) {
      current = candidate;
      continue;
    }
    if (current) contentPages.push(current);
    current = line;
  }
  if (current) contentPages.push(current);

  const total = contentPages.length;
  return contentPages.map((content, index) => ({
    index,
    total,
    text: total === 1 ? content : `${content}\n\nTrang ${index + 1}/${total}`,
    hasMore: index + 1 < total,
  }));
}
```

In `server/api/zalo-bot/chat/answerComposer.ts`, replace the local constant with a compatibility re-export while leaving all existing copy unchanged:

```ts
import type { ZaloBotChatAnswer } from './chatTypes.js';
import { ZALO_BOT_CHAT_MAX_TEXT } from './responseComposer.js';

export { ZALO_BOT_CHAT_MAX_TEXT } from './responseComposer.js';
```

- [ ] **Step 4: Run the new and legacy composer tests**

Run:

```bash
npm test -- server/api/zalo-bot/chat/responseComposer.test.ts server/api/zalo-bot/chat/answerComposer.test.ts
```

Expected: PASS. The legacy answer strings remain unchanged; the new module produces reusable pages.

- [ ] **Step 5: Commit the response foundation**

```bash
git add server/api/zalo-bot/chat/responseComposer.ts server/api/zalo-bot/chat/responseComposer.test.ts server/api/zalo-bot/chat/answerComposer.ts
git commit -m "feat: add adaptive Zalo response composer"
```

---

### Task 2: Define the shared capability catalog and immutable registry

**Files:**
- Create: `shared/zaloBotCapabilities.ts`
- Create: `shared/zaloBotCapabilities.test.ts`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityTypes.ts`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityRegistry.ts`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts`

**Interfaces:**
- Consumes: `ZaloBotAdaptiveResponse` from Task 1 and `ZaloBotStaffRole` from `shared/zaloBot.ts`.
- Produces: canonical capability-name unions, runtime mode guards, typed read/write definitions, and `createZaloBotCapabilityRegistry()`.

- [ ] **Step 1: Write failing catalog and registry tests**

Create `shared/zaloBotCapabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ZALO_BOT_CAPABILITY_NAMES,
  ZALO_BOT_READ_CAPABILITIES,
  ZALO_BOT_WRITE_CAPABILITIES,
  isZaloBotCapabilityName,
  isZaloBotWriteCapabilityName,
} from './zaloBotCapabilities.js';

describe('Zalo Bot capability catalog', () => {
  it('contains 31 unique names split into disjoint read and write sets', () => {
    expect(new Set(ZALO_BOT_CAPABILITY_NAMES).size).toBe(31);
    expect(
      ZALO_BOT_READ_CAPABILITIES.filter((name) =>
        (ZALO_BOT_WRITE_CAPABILITIES as readonly string[]).includes(name)
      )
    ).toEqual([]);
  });

  it('recognizes only catalog names and their declared mode', () => {
    expect(isZaloBotCapabilityName('class.roster.count')).toBe(true);
    expect(isZaloBotCapabilityName('database.query')).toBe(false);
    expect(isZaloBotWriteCapabilityName('attendance.mark_or_correct')).toBe(true);
    expect(isZaloBotWriteCapabilityName('attendance.today')).toBe(false);
  });
});
```

Create `server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts` using a small read definition:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createZaloBotCapabilityRegistry } from './capabilityRegistry.js';
import type { ZaloBotReadCapabilityDefinition } from './capabilityTypes.js';

const countCapability: ZaloBotReadCapabilityDefinition<
  { classHint: string },
  { classId: string },
  { count: number }
> = {
  name: 'class.roster.count',
  version: 1,
  mode: 'read',
  allowedRoles: ['teacher', 'office', 'admin'],
  sensitivity: 'personal',
  draftSchema: z.object({ classHint: z.string() }),
  resolve: async (_actor, draft) => ({ classId: draft.classHint }),
  authorize: async () => undefined,
  query: async () => ({ count: 1 }),
  compose: (result) => ({ conclusion: `${result.count} học viên.` }),
};

describe('createZaloBotCapabilityRegistry', () => {
  it('returns immutable lookup and stable registration order', () => {
    const registry = createZaloBotCapabilityRegistry([countCapability]);
    expect(registry.get('class.roster.count')).toBe(countCapability);
    expect(registry.require('class.roster.count')).toBe(countCapability);
    expect(registry.list()).toEqual([countCapability]);
    expect(() => registry.require('student.lookup')).toThrow('Capability is not registered');
  });

  it('rejects duplicate names', () => {
    expect(() =>
      createZaloBotCapabilityRegistry([countCapability, countCapability])
    ).toThrow('Duplicate Zalo Bot capability: class.roster.count');
  });

  it('rejects a definition whose mode disagrees with the shared catalog', () => {
    expect(() =>
      createZaloBotCapabilityRegistry([{ ...countCapability, mode: 'write' } as any])
    ).toThrow('Capability mode mismatch: class.roster.count');
  });
});
```

- [ ] **Step 2: Run both tests and confirm the modules are missing**

Run:

```bash
npm test -- shared/zaloBotCapabilities.test.ts server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts
```

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement the canonical capability vocabulary**

Create `shared/zaloBotCapabilities.ts`:

```ts
export const ZALO_BOT_READ_CAPABILITIES = [
  'class.roster.count',
  'class.roster.list',
  'class.end_date',
  'class.schedule',
  'attendance.today',
  'attendance.session_status',
  'attendance.history',
  'task.my',
  'print_request.status',
  'print_request.queue',
  'student.lookup',
  'student.contact',
  'student.academic',
  'student.tuition',
  'student.wallet',
  'finance.receipts',
  'finance.expenses',
  'finance.center_summary',
  'teacher.payroll',
  'zalo.operations',
] as const;

export const ZALO_BOT_WRITE_CAPABILITIES = [
  'attendance.mark_or_correct',
  'print_request.create',
  'print_request.cancel',
  'print_request.update_status',
  'notification.queue',
  'finance.receipt.create_and_post',
  'finance.receipt.void',
  'finance.expense.create_and_post',
  'finance.expense.void',
  'finance.wallet.allocate',
  'finance.wallet.void',
] as const;

export const ZALO_BOT_CAPABILITY_NAMES = [
  ...ZALO_BOT_READ_CAPABILITIES,
  ...ZALO_BOT_WRITE_CAPABILITIES,
] as const;

export type ZaloBotReadCapabilityName = (typeof ZALO_BOT_READ_CAPABILITIES)[number];
export type ZaloBotWriteCapabilityName = (typeof ZALO_BOT_WRITE_CAPABILITIES)[number];
export type ZaloBotCapabilityName = (typeof ZALO_BOT_CAPABILITY_NAMES)[number];

export function isZaloBotCapabilityName(value: unknown): value is ZaloBotCapabilityName {
  return (
    typeof value === 'string' &&
    (ZALO_BOT_CAPABILITY_NAMES as readonly string[]).includes(value)
  );
}

export function isZaloBotWriteCapabilityName(
  value: ZaloBotCapabilityName
): value is ZaloBotWriteCapabilityName {
  return (ZALO_BOT_WRITE_CAPABILITIES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Implement the typed definition contracts and registry**

Create `server/api/zalo-bot/chat/capabilities/capabilityTypes.ts`:

```ts
import type { ZodType } from 'zod';
import type { ZaloBotCapabilityName } from '../../../../../shared/zaloBotCapabilities.js';
import type { ZaloBotStaffRole } from '../../../../../shared/zaloBot.js';
import type { ZaloBotAdaptiveResponse } from '../responseComposer.js';

export type ZaloBotCapabilitySensitivity = 'normal' | 'personal' | 'financial';
export type ZaloBotCapabilityArgs = Readonly<Record<string, unknown>>;

export type ZaloBotCapabilityActor = {
  staffId: string;
  chatIdHash: string;
  role: ZaloBotStaffRole;
  now: string;
};

type CapabilityBase<TDraft, TArgs extends ZaloBotCapabilityArgs> = {
  name: ZaloBotCapabilityName;
  version: number;
  allowedRoles: readonly ZaloBotStaffRole[];
  sensitivity: ZaloBotCapabilitySensitivity;
  draftSchema: ZodType<TDraft>;
  resolve(actor: ZaloBotCapabilityActor, draft: TDraft): Promise<TArgs>;
  authorize(actor: ZaloBotCapabilityActor, args: TArgs): Promise<void>;
};

export type ZaloBotReadCapabilityDefinition<
  TDraft = unknown,
  TArgs extends ZaloBotCapabilityArgs = ZaloBotCapabilityArgs,
  TResult = unknown,
> = CapabilityBase<TDraft, TArgs> & {
  mode: 'read';
  query(actor: ZaloBotCapabilityActor, args: TArgs): Promise<TResult>;
  compose(result: TResult): ZaloBotAdaptiveResponse;
};

export type ZaloBotConfirmedCommand<TArgs extends ZaloBotCapabilityArgs> = {
  commandId: string;
  idempotencyKey: string;
  canonicalArgs: TArgs;
  stateFingerprint: string;
};

export type ZaloBotWriteCapabilityDefinition<
  TDraft = unknown,
  TArgs extends ZaloBotCapabilityArgs = ZaloBotCapabilityArgs,
  TPreview = unknown,
  TResult = unknown,
> = CapabilityBase<TDraft, TArgs> & {
  mode: 'write';
  prepare(
    actor: ZaloBotCapabilityActor,
    args: TArgs
  ): Promise<{ preview: TPreview; stateFingerprint: string }>;
  composePreview(preview: TPreview): ZaloBotAdaptiveResponse;
  execute(
    actor: ZaloBotCapabilityActor,
    command: ZaloBotConfirmedCommand<TArgs>
  ): Promise<TResult>;
  composeResult(result: TResult): ZaloBotAdaptiveResponse;
};

export type ZaloBotCapabilityDefinition =
  | ZaloBotReadCapabilityDefinition<any, any, any>
  | ZaloBotWriteCapabilityDefinition<any, any, any, any>;
```

Create `server/api/zalo-bot/chat/capabilities/capabilityRegistry.ts`:

```ts
import {
  isZaloBotCapabilityName,
  isZaloBotWriteCapabilityName,
  type ZaloBotCapabilityName,
} from '../../../../../shared/zaloBotCapabilities.js';
import { isZaloBotStaffRole } from '../../../../../shared/zaloBot.js';
import type { ZaloBotCapabilityDefinition } from './capabilityTypes.js';

export type ZaloBotCapabilityRegistry = {
  get(name: ZaloBotCapabilityName): ZaloBotCapabilityDefinition | undefined;
  require(name: ZaloBotCapabilityName): ZaloBotCapabilityDefinition;
  list(): readonly ZaloBotCapabilityDefinition[];
};

export function createZaloBotCapabilityRegistry(
  definitions: readonly ZaloBotCapabilityDefinition[]
): ZaloBotCapabilityRegistry {
  const byName = new Map<ZaloBotCapabilityName, ZaloBotCapabilityDefinition>();

  for (const definition of definitions) {
    if (!isZaloBotCapabilityName(definition.name)) {
      throw new Error(`Unknown Zalo Bot capability: ${String(definition.name)}`);
    }
    if (byName.has(definition.name)) {
      throw new Error(`Duplicate Zalo Bot capability: ${definition.name}`);
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`Invalid capability version: ${definition.name}`);
    }
    if (
      definition.allowedRoles.length === 0 ||
      definition.allowedRoles.some((role) => !isZaloBotStaffRole(role))
    ) {
      throw new Error(`Invalid capability roles: ${definition.name}`);
    }
    const expectedMode = isZaloBotWriteCapabilityName(definition.name) ? 'write' : 'read';
    if (definition.mode !== expectedMode) {
      throw new Error(`Capability mode mismatch: ${definition.name}`);
    }
    byName.set(definition.name, Object.freeze(definition));
  }

  const ordered = Object.freeze([...byName.values()]);
  return Object.freeze({
    get: (name: ZaloBotCapabilityName) => byName.get(name),
    require: (name: ZaloBotCapabilityName) => {
      const definition = byName.get(name);
      if (!definition) throw new Error(`Capability is not registered: ${name}`);
      return definition;
    },
    list: () => ordered,
  });
}
```

- [ ] **Step 5: Run catalog, registry, and type checks**

Run:

```bash
npm test -- shared/zaloBotCapabilities.test.ts server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the registry contract**

```bash
git add shared/zaloBotCapabilities.ts shared/zaloBotCapabilities.test.ts server/api/zalo-bot/chat/capabilities/capabilityTypes.ts server/api/zalo-bot/chat/capabilities/capabilityRegistry.ts server/api/zalo-bot/chat/capabilities/capabilityRegistry.test.ts
git commit -m "feat: add Zalo bot capability registry"
```

---

### Task 3: Parse fail-closed capability configuration and evaluate gates

**Files:**
- Modify: `server/api/zalo-bot/config.ts:1-152`
- Modify: `server/api/zalo-bot/config.test.ts:1-181`
- Modify: `server/api/zalo-bot/digestService.test.ts:129-149`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityGates.ts`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts`

**Interfaces:**
- Consumes: `ZALO_BOT_CAPABILITY_NAMES`, `ZALO_BOT_STAFF_ROLES`, and `isZaloBotWriteCapabilityName()`.
- Produces: six new `ZaloBotConfig` fields and `evaluateZaloBotCapabilityGate(config, input)` returning `{ allowed: true }` or a typed denial reason.

- [ ] **Step 1: Write failing config parser tests**

Append this block to `server/api/zalo-bot/config.test.ts`:

```ts
describe('capability registry gates', () => {
  it('defaults every new gate closed', () => {
    delete process.env.ZALO_BOT_CAPABILITY_REGISTRY_ENABLED;
    delete process.env.ZALO_BOT_WRITE_ENABLED;
    delete process.env.ZALO_BOT_ROLES_ENABLED;
    delete process.env.ZALO_BOT_CAPABILITIES_ENABLED;
    delete process.env.ZALO_BOT_CAPABILITY_AUDIENCE;
    delete process.env.ZALO_BOT_CAPABILITY_PILOT_UIDS;

    expect(loadZaloBotConfig()).toMatchObject({
      capabilityRegistryEnabled: false,
      writeEnabled: false,
      capabilityRolesEnabled: [],
      capabilitiesEnabled: [],
      capabilityAudience: 'none',
      capabilityPilotUids: [],
    });
  });

  it('parses and deduplicates known roles, capabilities, and pilot UIDs', () => {
    process.env.ZALO_BOT_CAPABILITY_REGISTRY_ENABLED = 'true';
    process.env.ZALO_BOT_WRITE_ENABLED = 'false';
    process.env.ZALO_BOT_ROLES_ENABLED = 'teacher,admin,teacher';
    process.env.ZALO_BOT_CAPABILITIES_ENABLED =
      'class.roster.count,student.tuition,class.roster.count';
    process.env.ZALO_BOT_CAPABILITY_AUDIENCE = 'pilot';
    process.env.ZALO_BOT_CAPABILITY_PILOT_UIDS = 'u1,u2,u1';

    expect(loadZaloBotConfig()).toMatchObject({
      capabilityRegistryEnabled: true,
      writeEnabled: false,
      capabilityRolesEnabled: ['teacher', 'admin'],
      capabilitiesEnabled: ['class.roster.count', 'student.tuition'],
      capabilityAudience: 'pilot',
      capabilityPilotUids: ['u1', 'u2'],
    });
  });

  it.each([
    ['ZALO_BOT_ROLES_ENABLED', 'teacher,owner'],
    ['ZALO_BOT_CAPABILITIES_ENABLED', 'class.roster.count,database.query'],
    ['ZALO_BOT_CAPABILITY_AUDIENCE', 'everyone'],
  ])('rejects unknown %s values', (name, value) => {
    process.env[name] = value;
    expect(() => loadZaloBotConfig()).toThrow(name);
  });

  it('rejects pilot audience without at least one UID', () => {
    process.env.ZALO_BOT_CAPABILITY_AUDIENCE = 'pilot';
    delete process.env.ZALO_BOT_CAPABILITY_PILOT_UIDS;
    expect(() => loadZaloBotConfig()).toThrow(
      'ZALO_BOT_CAPABILITY_PILOT_UIDS is required when audience is pilot'
    );
  });
});
```

- [ ] **Step 2: Write failing pure gate tests**

Create `server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ZaloBotConfig } from '../../config.js';
import { evaluateZaloBotCapabilityGate } from './capabilityGates.js';

const baseConfig = {
  capabilityRegistryEnabled: true,
  writeEnabled: false,
  capabilityRolesEnabled: ['teacher'],
  capabilitiesEnabled: ['class.roster.count', 'attendance.mark_or_correct'],
  capabilityAudience: 'pilot',
  capabilityPilotUids: ['teacher_1'],
} as unknown as ZaloBotConfig;

const denialCases: Array<
  [Partial<ZaloBotConfig>, 'registry_disabled' | 'capability_disabled' | 'role_disabled' | 'audience_none' | 'not_in_pilot']
> = [
  [{ capabilityRegistryEnabled: false }, 'registry_disabled'],
  [{ capabilitiesEnabled: [] }, 'capability_disabled'],
  [{ capabilityRolesEnabled: [] }, 'role_disabled'],
  [{ capabilityAudience: 'none' }, 'audience_none'],
  [{ capabilityPilotUids: ['someone_else'] }, 'not_in_pilot'],
];

describe('evaluateZaloBotCapabilityGate', () => {
  it('allows a pilot read only when every gate matches', () => {
    expect(
      evaluateZaloBotCapabilityGate(baseConfig, {
        staffId: 'teacher_1',
        role: 'teacher',
        capability: 'class.roster.count',
      })
    ).toEqual({ allowed: true });
  });

  it.each(denialCases)('fails closed for %s', (patch, reason) => {
    expect(
      evaluateZaloBotCapabilityGate({ ...baseConfig, ...patch }, {
        staffId: 'teacher_1',
        role: 'teacher',
        capability: 'class.roster.count',
      })
    ).toEqual({ allowed: false, reason });
  });

  it('requires the write master for a write capability', () => {
    expect(
      evaluateZaloBotCapabilityGate(baseConfig, {
        staffId: 'teacher_1',
        role: 'teacher',
        capability: 'attendance.mark_or_correct',
      })
    ).toEqual({ allowed: false, reason: 'write_disabled' });
  });

  it('allows all users only with explicit audience all', () => {
    expect(
      evaluateZaloBotCapabilityGate(
        { ...baseConfig, capabilityAudience: 'all', capabilityPilotUids: [] },
        { staffId: 'teacher_2', role: 'teacher', capability: 'class.roster.count' }
      )
    ).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 3: Run the config and gate tests and confirm failure**

Run:

```bash
npm test -- server/api/zalo-bot/config.test.ts server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts
```

Expected: FAIL because config fields and the gate module do not exist.

- [ ] **Step 4: Add strict config parsing**

In `server/api/zalo-bot/config.ts`, import the catalogs and extend `ZaloBotConfig`:

```ts
import {
  ZALO_BOT_CAPABILITY_NAMES,
  type ZaloBotCapabilityName,
} from '../../../shared/zaloBotCapabilities.js';
import { ZALO_BOT_STAFF_ROLES, type ZaloBotStaffRole } from '../../../shared/zaloBot.js';

export type ZaloBotCapabilityAudience = 'none' | 'pilot' | 'all';

// Add to ZaloBotConfig:
capabilityRegistryEnabled: boolean;
writeEnabled: boolean;
capabilityRolesEnabled: ZaloBotStaffRole[];
capabilitiesEnabled: ZaloBotCapabilityName[];
capabilityAudience: ZaloBotCapabilityAudience;
capabilityPilotUids: string[];
```

Add strict helpers:

```ts
function parseKnownList<T extends string>(
  envName: string,
  raw: string | undefined,
  allowed: readonly T[]
): T[] {
  if (!raw?.trim()) return [];
  const result: T[] = [];
  for (const value of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`Invalid value in ${envName}: "${value}"`);
    }
    if (!result.includes(value as T)) result.push(value as T);
  }
  return result;
}

function readCapabilityAudience(): ZaloBotCapabilityAudience {
  const value = process.env.ZALO_BOT_CAPABILITY_AUDIENCE?.trim() || 'none';
  if (!['none', 'pilot', 'all'].includes(value)) {
    throw new Error(`Invalid ZALO_BOT_CAPABILITY_AUDIENCE: "${value}"`);
  }
  return value as ZaloBotCapabilityAudience;
}
```

Inside `loadZaloBotConfig()`, parse before the credential checks:

```ts
const capabilityRegistryEnabled = readBooleanEnv('ZALO_BOT_CAPABILITY_REGISTRY_ENABLED');
const writeEnabled = readBooleanEnv('ZALO_BOT_WRITE_ENABLED');
const capabilityRolesEnabled = parseKnownList(
  'ZALO_BOT_ROLES_ENABLED',
  process.env.ZALO_BOT_ROLES_ENABLED,
  ZALO_BOT_STAFF_ROLES
);
const capabilitiesEnabled = parseKnownList(
  'ZALO_BOT_CAPABILITIES_ENABLED',
  process.env.ZALO_BOT_CAPABILITIES_ENABLED,
  ZALO_BOT_CAPABILITY_NAMES
);
const capabilityAudience = readCapabilityAudience();
const capabilityPilotUids = [...new Set(parsePilotUids(process.env.ZALO_BOT_CAPABILITY_PILOT_UIDS))];
if (capabilityAudience === 'pilot' && capabilityPilotUids.length === 0) {
  throw new Error('ZALO_BOT_CAPABILITY_PILOT_UIDS is required when audience is pilot');
}
```

Return those six fields from `loadZaloBotConfig()`.

Extend the exact `getBaseConfig()` fixture in `server/api/zalo-bot/digestService.test.ts` so it continues to satisfy `ZaloBotConfig` without enabling Foundation:

```ts
capabilityRegistryEnabled: false,
writeEnabled: false,
capabilityRolesEnabled: [],
capabilitiesEnabled: [],
capabilityAudience: 'none',
capabilityPilotUids: [],
```

- [ ] **Step 5: Implement the pure gate evaluator**

Create `server/api/zalo-bot/chat/capabilities/capabilityGates.ts`:

```ts
import type { ZaloBotConfig } from '../../config.js';
import type { ZaloBotStaffRole } from '../../../../../shared/zaloBot.js';
import {
  isZaloBotWriteCapabilityName,
  type ZaloBotCapabilityName,
} from '../../../../../shared/zaloBotCapabilities.js';

export const ZALO_BOT_CAPABILITY_GATE_DENIALS = [
  'registry_disabled',
  'capability_disabled',
  'role_disabled',
  'audience_none',
  'not_in_pilot',
  'write_disabled',
] as const;

export type ZaloBotCapabilityGateDenial =
  (typeof ZALO_BOT_CAPABILITY_GATE_DENIALS)[number];

export type ZaloBotCapabilityGateResult =
  | { allowed: true }
  | { allowed: false; reason: ZaloBotCapabilityGateDenial };

type CapabilityGateConfig = Pick<
  ZaloBotConfig,
  | 'capabilityRegistryEnabled'
  | 'writeEnabled'
  | 'capabilityRolesEnabled'
  | 'capabilitiesEnabled'
  | 'capabilityAudience'
  | 'capabilityPilotUids'
>;

export function evaluateZaloBotCapabilityGate(
  config: CapabilityGateConfig,
  input: { staffId: string; role: ZaloBotStaffRole; capability: ZaloBotCapabilityName }
): ZaloBotCapabilityGateResult {
  if (!config.capabilityRegistryEnabled) return { allowed: false, reason: 'registry_disabled' };
  if (!config.capabilitiesEnabled.includes(input.capability)) {
    return { allowed: false, reason: 'capability_disabled' };
  }
  if (!config.capabilityRolesEnabled.includes(input.role)) {
    return { allowed: false, reason: 'role_disabled' };
  }
  if (config.capabilityAudience === 'none') {
    return { allowed: false, reason: 'audience_none' };
  }
  if (
    config.capabilityAudience === 'pilot' &&
    !config.capabilityPilotUids.includes(input.staffId)
  ) {
    return { allowed: false, reason: 'not_in_pilot' };
  }
  if (isZaloBotWriteCapabilityName(input.capability) && !config.writeEnabled) {
    return { allowed: false, reason: 'write_disabled' };
  }
  return { allowed: true };
}
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm test -- server/api/zalo-bot/config.test.ts server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the fail-closed gates**

```bash
git add server/api/zalo-bot/config.ts server/api/zalo-bot/config.test.ts server/api/zalo-bot/digestService.test.ts server/api/zalo-bot/chat/capabilities/capabilityGates.ts server/api/zalo-bot/chat/capabilities/capabilityGates.test.ts
git commit -m "feat: add fail-closed Zalo capability gates"
```

---

### Task 4: Make accounting a linkable server-side bot role

**Files:**
- Modify: `shared/zaloBot.ts:1-4,48-50`
- Modify: `shared/zaloBot.test.ts:1-14`
- Modify: `server/api/zalo-bot/routeHandler.ts:1-24`
- Modify: `api/zalo-bot/action.test.ts:1-82`
- Modify: `server/api/zalo-bot/linkHandlers.ts:12-20,145-169,301-310`
- Modify: `server/api/zalo-bot/linkHandlers.test.ts:1-230`
- Modify: `server/api/zalo-bot/deliveryService.test.ts:1-120`

**Interfaces:**
- Consumes: existing link repository, auth context, audit, and message/outbox contracts.
- Produces: `ZALO_BOT_STAFF_ROLES` with accounting plus explicit `ZALO_BOT_LEGACY_CHAT_ROLES` and `ZALO_BOT_DAILY_DIGEST_ROLES` subsets used by Task 5.

- [ ] **Step 1: Write failing role-contract tests**

Update the first test in `shared/zaloBot.test.ts`:

```ts
import {
  ZALO_BOT_DAILY_DIGEST_ROLES,
  ZALO_BOT_LEGACY_CHAT_ROLES,
  ZALO_BOT_STAFF_ROLES,
  isZaloBotStaffRole,
  makeZaloBotDailyMessageId,
  parseZaloBotLinkCommand,
} from './zaloBot.js';

it('separates linkable roles from legacy chat and digest roles', () => {
  expect(ZALO_BOT_STAFF_ROLES).toEqual(['teacher', 'office', 'accounting', 'admin']);
  expect(ZALO_BOT_LEGACY_CHAT_ROLES).toEqual(['teacher', 'office', 'admin']);
  expect(ZALO_BOT_DAILY_DIGEST_ROLES).toEqual(['teacher', 'office', 'admin']);
  expect(isZaloBotStaffRole('accounting')).toBe(true);
  expect(isZaloBotStaffRole('student')).toBe(false);
});
```

- [ ] **Step 2: Write failing server-link tests for accounting**

In `api/zalo-bot/action.test.ts`, add:

```ts
it('allows accounting to use self-link routes', async () => {
  const req = {} as any;
  const res = {} as any;
  vi.mocked(verifyAuthContext).mockResolvedValueOnce({
    context: { uid: 'accounting_1', role: 'accounting' },
  } as any);

  await dispatchZaloBotRoute('my-link', req, res);

  expect(verifyAuthContext).toHaveBeenCalledWith(req, res, [
    'teacher',
    'office',
    'accounting',
    'admin',
  ]);
  expect(dispatchZaloBotSelfAction).toHaveBeenCalledWith('my-link', req, res, {
    uid: 'accounting_1',
    role: 'accounting',
  });
});
```

In `server/api/zalo-bot/linkHandlers.test.ts`, add:

```ts
it('admin-link accepts an accounting target', async () => {
  req.body = { staffId: 'accounting-1', chatIdHash: 'hash-1' };
  mockDb.get.mockResolvedValueOnce({
    exists: true,
    data: () => ({ role: 'accounting', displayName: 'Kế toán A' }),
  });
  vi.mocked(linkRepo.adminLinkZaloBotChat).mockResolvedValueOnce({
    staffId: 'accounting-1',
    role: 'accounting',
    chatId: 'chat-1',
    chatIdHash: 'hash-1',
    displayName: 'Kế toán A',
    status: 'active',
    linkedMethod: 'admin',
    linkedBy: 'u1',
    linkedAt: '2026-08-22T00:00:00.000Z',
    lastSeenAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  });

  await dispatchZaloBotAdminAction('admin-link', req, res, context);

  expect(linkRepo.adminLinkZaloBotChat).toHaveBeenCalledWith(
    mockDb,
    expect.objectContaining({
      staff: expect.objectContaining({ uid: 'accounting-1', role: 'accounting' }),
    }),
    expect.any(Object)
  );
  expect(res.status).toHaveBeenCalledWith(200);
});
```

Also extend the existing admin overview test:

```ts
expect(mockDb.where).toHaveBeenCalledWith('role', 'in', [
  'teacher',
  'office',
  'accounting',
  'admin',
]);
```

Add a focused admin-test assertion to `server/api/zalo-bot/linkHandlers.test.ts`:

```ts
it('admin-test queues a test message for an active accounting link', async () => {
  req.method = 'POST';
  req.body = { staffId: 'accounting-1' };
  mockDb.get
    .mockResolvedValueOnce({
      exists: true,
      data: () => ({ role: 'accounting', displayName: 'Kế toán A' }),
    })
    .mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'active', role: 'accounting', chatIdHash: 'hash-1' }),
    });

  await dispatchZaloBotAdminAction('admin-test', req, res, context);

  expect(createZaloBotMessageIfAbsent).toHaveBeenCalledWith(
    mockDb,
    expect.objectContaining({ staffId: 'accounting-1', role: 'accounting', messageType: 'test' })
  );
  expect(res.status).toHaveBeenCalledWith(200);
});
```

Add to `server/api/zalo-bot/deliveryService.test.ts`:

```ts
it('delivers link and test messages to an eligible accounting link', async () => {
  await setupData('pending', 'active', 'accounting');
  store.set('zalo_bot_messages/msg1', {
    ...store.get('zalo_bot_messages/msg1'),
    role: 'accounting',
    messageType: 'test',
  });
  sendTextMock.mockResolvedValue({ messageId: 'prov-accounting-1' });

  await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

  expect(sendTextMock).toHaveBeenCalledTimes(1);
  expect(store.get('zalo_bot_messages/msg1')).toMatchObject({
    status: 'sent',
    providerMessageId: 'prov-accounting-1',
  });
});
```

- [ ] **Step 3: Run the role and link tests and confirm failure**

Run:

```bash
npm test -- shared/zaloBot.test.ts api/zalo-bot/action.test.ts server/api/zalo-bot/linkHandlers.test.ts server/api/zalo-bot/deliveryService.test.ts
```

Expected: FAIL because accounting is not yet linkable and the route still authorizes three roles.

- [ ] **Step 4: Add explicit full and legacy role constants**

At the top of `shared/zaloBot.ts`:

```ts
export const ZALO_BOT_STAFF_ROLES = ['teacher', 'office', 'accounting', 'admin'] as const;
export type ZaloBotStaffRole = (typeof ZALO_BOT_STAFF_ROLES)[number];

export const ZALO_BOT_LEGACY_CHAT_ROLES = ['teacher', 'office', 'admin'] as const satisfies readonly ZaloBotStaffRole[];
export const ZALO_BOT_DAILY_DIGEST_ROLES = ['teacher', 'office', 'admin'] as const satisfies readonly ZaloBotStaffRole[];
```

Keep `isZaloBotStaffRole()` based on the full `ZALO_BOT_STAFF_ROLES` array.

- [ ] **Step 5: Use the full role list for self-linking, overview, linking, and test sends**

In `server/api/zalo-bot/routeHandler.ts`, import the role constant and authorize self actions with a mutable copy:

```ts
import { ZALO_BOT_STAFF_ROLES } from '../../../shared/zaloBot.js';

const verified = await verifyAuthContext(req, res, [...ZALO_BOT_STAFF_ROLES]);
```

In `server/api/zalo-bot/linkHandlers.ts`, use the same canonical predicate/list:

```ts
db.collection('users').where('role', 'in', [...ZALO_BOT_STAFF_ROLES]).get()

if (!isZaloBotStaffRole(userData.role)) {
  return res.status(409).json({ success: false, error: 'Ineligible role' });
}
```

Use that predicate in both `admin-link` and `admin-test`; do not change the link repository, audit payload, or outbox behavior.

- [ ] **Step 6: Run server role/link tests and typecheck**

Run:

```bash
npm test -- shared/zaloBot.test.ts api/zalo-bot/action.test.ts server/api/zalo-bot/linkHandlers.test.ts server/api/zalo-bot/linkRepository.test.ts server/api/zalo-bot/linkConfirmationService.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit accounting link support**

```bash
git add shared/zaloBot.ts shared/zaloBot.test.ts server/api/zalo-bot/routeHandler.ts api/zalo-bot/action.test.ts server/api/zalo-bot/linkHandlers.ts server/api/zalo-bot/linkHandlers.test.ts server/api/zalo-bot/deliveryService.test.ts
git commit -m "feat: support Zalo links for accounting staff"
```

---

### Task 5: Expose accounting linking in the UI while isolating legacy chat and digest

**Files:**
- Modify: `src/components/zalo/ZaloBotLinkCard.tsx:1-32`
- Modify: `src/components/zalo/ZaloBotLinkCard.test.tsx:1-43`
- Modify: `src/pages/common/Profile.zaloBot.test.tsx:42-70`
- Modify: `server/api/zalo-bot/chat/chatService.ts:4-8,63-73`
- Modify: `server/api/zalo-bot/chat/chatService.test.ts:50-100,150-230`
- Modify: `server/api/zalo-bot/digestSources.ts:1-20,164-178`
- Modify: `server/api/zalo-bot/digestSources.test.ts:1-120`

**Interfaces:**
- Consumes: `isZaloBotStaffRole`, `ZALO_BOT_LEGACY_CHAT_ROLES`, and `ZALO_BOT_DAILY_DIGEST_ROLES` from Task 4.
- Produces: accounting self-link UI plus regression tests proving a linked accountant gets neither legacy AI answers nor daily digest eligibility.

- [ ] **Step 1: Write failing accounting UI tests**

Add to `src/components/zalo/ZaloBotLinkCard.test.tsx`:

```tsx
it('renders the link card for accounting', async () => {
  vi.mocked(zaloBotService.getMyZaloBotLink).mockResolvedValueOnce({
    botEnabled: true,
    link: null,
  });

  renderComponent('accounting');

  expect(await screen.findByText('Tạo mã liên kết')).toBeInTheDocument();
});
```

Add to `src/pages/common/Profile.zaloBot.test.tsx`:

```tsx
it('renders ZaloBotLinkCard for accounting in the security tab', async () => {
  renderProfile('accounting');
  screen.getByText(/Bảo mật|Security/i).click();
  await waitFor(() => {
    expect(screen.getByTestId('zalo-bot-link-card')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing legacy-boundary tests**

Add to `server/api/zalo-bot/chat/chatService.test.ts`:

```ts
it('keeps accounting out of the legacy chat path', async () => {
  memory.store.set('users/accounting_a', { role: 'accounting', displayName: 'Kế toán A' });
  memory.store.set('zalo_bot_links/accounting_a', {
    staffId: 'accounting_a',
    chatId: 'chat_accounting',
    chatIdHash: 'hash_accounting',
    role: 'accounting',
    status: 'active',
  });

  const result = await answerZaloBotChatMessage(
    db,
    {
      staffId: 'accounting_a',
      chatId: 'chat_accounting',
      text: 'xem học phí học viên A',
      zaloMessageId: 'zm_accounting',
      now: '2026-08-22T03:00:00.000Z',
    },
    makeDeps()
  );

  expect(result).toEqual({ outcome: 'ineligible' });
  expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.sendText).not.toHaveBeenCalled();
});
```

Add to `server/api/zalo-bot/digestSources.test.ts`:

```ts
it('excludes accounting links from the legacy daily digest audience', async () => {
  queryMocks.zalo_bot_links.get.mockResolvedValue({
    docs: [
      {
        id: 'accounting_a',
        data: () => ({
          staffId: 'accounting_a',
          role: 'accounting',
          status: 'active',
          chatIdHash: 'hash_accounting',
        }),
      },
    ],
  });
  queryMocks.users.get.mockResolvedValue({
    docs: [{ id: 'accounting_a', data: () => ({ role: 'accounting' }) }],
  });

  const result = await collectZaloBotDigestSources(mockDb, {
    digestDate: '2026-08-22',
    tomorrowDate: '2026-08-23',
  });

  expect(result.activeRecipients).toEqual([]);
  expect(result.sourceCounts.activeLinks).toBe(1);
  expect(result.sourceCounts.eligibleRecipients).toBe(0);
});
```

- [ ] **Step 3: Run UI and legacy-boundary tests and confirm failure**

Run:

```bash
npm test -- src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx server/api/zalo-bot/chat/chatService.test.ts server/api/zalo-bot/digestSources.test.ts
```

Expected: UI tests fail because accounting is hidden; chat test fails because the full linkable role list would otherwise admit accounting after Task 4.

- [ ] **Step 4: Use the canonical role predicate in the link card**

In `src/components/zalo/ZaloBotLinkCard.tsx`:

```tsx
import { isZaloBotStaffRole } from '../../../shared/zaloBot';

export function ZaloBotLinkCard({ role }: ZaloBotLinkCardProps) {
  const { language } = useLanguage();
  const roleCanLink = isZaloBotStaffRole(role);

  useEffect(() => {
    if (roleCanLink) void fetchLink();
  }, [roleCanLink]);

  if (!roleCanLink) return null;
```

Remove the local `allowedRoles` array. Leave all link/unlink copy and behavior unchanged.

- [ ] **Step 5: Enforce explicit legacy chat and digest subsets**

In `server/api/zalo-bot/chat/chatService.ts`, replace `ZALO_BOT_STAFF_ROLES` with the legacy constant for the pre-registry path:

```ts
import {
  ZALO_BOT_LEGACY_CHAT_ROLES,
  ZALO_BOT_SENSITIVE_CONTENT_MARKER,
} from '../../../../shared/zaloBot.js';

if (
  !actor.role ||
  !(ZALO_BOT_LEGACY_CHAT_ROLES as readonly string[]).includes(actor.role)
) {
  return { outcome: 'ineligible' };
}
```

In `server/api/zalo-bot/digestSources.ts`, use the digest subset:

```ts
import { ZALO_BOT_DAILY_DIGEST_ROLES } from '../../../shared/zaloBot.js';

if (!(ZALO_BOT_DAILY_DIGEST_ROLES as readonly string[]).includes(currentRole)) continue;
```

- [ ] **Step 6: Run UI, legacy chat, digest, and delivery tests**

Run:

```bash
npm test -- src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx server/api/zalo-bot/chat/chatService.test.ts server/api/zalo-bot/digestSources.test.ts server/api/zalo-bot/digestRules.test.ts server/api/zalo-bot/deliveryService.test.ts
npm run typecheck
```

Expected: PASS. Accounting can link and receive test/link messages, but no legacy chat query or daily digest is created for it.

- [ ] **Step 7: Commit the UI and compatibility boundary**

```bash
git add src/components/zalo/ZaloBotLinkCard.tsx src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx server/api/zalo-bot/chat/chatService.ts server/api/zalo-bot/chat/chatService.test.ts server/api/zalo-bot/digestSources.ts server/api/zalo-bot/digestSources.test.ts
git commit -m "feat: expose accounting Zalo links safely"
```

---

### Task 6: Add privacy-safe capability metrics and operations documentation

**Files:**
- Create: `server/api/zalo-bot/chat/capabilities/capabilityMetrics.ts`
- Create: `server/api/zalo-bot/chat/capabilities/capabilityMetrics.test.ts`
- Modify: `.env.example:105-126`
- Modify: `docs/zalo-bot-runbook.md:1-165`

**Interfaces:**
- Consumes: `ZaloBotCapabilityName`, `ZaloBotStaffRole`, and `ZaloBotCapabilityGateDenial`.
- Produces: `createZaloBotCapabilityMetric()` and `emitZaloBotCapabilityMetric()` for subsequent coordinator/adapters, plus exact operator defaults.

- [ ] **Step 1: Write failing privacy-safe metric tests**

Create `server/api/zalo-bot/chat/capabilities/capabilityMetrics.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createZaloBotCapabilityMetric,
  emitZaloBotCapabilityMetric,
} from './capabilityMetrics.js';

describe('Zalo Bot capability metrics', () => {
  it('builds an exact categorical record without identity or content fields', () => {
    const metric = createZaloBotCapabilityMetric(
      ({
        event: 'feature_gate_denied',
        capability: 'student.tuition',
        role: 'accounting',
        gateReason: 'not_in_pilot',
        durationMs: 12.8,
        staffId: 'must-not-appear',
        question: 'must-not-appear',
      } as any),
      () => '2026-08-22T12:00:00.000Z'
    );

    expect(metric).toEqual({
      component: 'zalo_bot_capability',
      event: 'feature_gate_denied',
      capability: 'student.tuition',
      role: 'accounting',
      gateReason: 'not_in_pilot',
      durationMs: 13,
      timestamp: '2026-08-22T12:00:00.000Z',
    });
    expect(JSON.stringify(metric)).not.toMatch(/staffId|chatId|question|amount|phone/i);
  });

  it('emits through an injectable sink', () => {
    const sink = vi.fn();
    emitZaloBotCapabilityMetric(
      { event: 'read_succeeded', capability: 'class.roster.count', role: 'teacher' },
      { sink, now: () => '2026-08-22T12:00:00.000Z' }
    );
    expect(sink).toHaveBeenCalledWith(
      '[zalo-bot-capability-metric]',
      expect.objectContaining({ event: 'read_succeeded' })
    );
  });

  it('rejects invalid durations instead of logging them', () => {
    expect(() =>
      createZaloBotCapabilityMetric({ event: 'read_failed', durationMs: -1 })
    ).toThrow('Capability metric duration must be a non-negative finite number');
  });
});
```

- [ ] **Step 2: Run the metric test and confirm the module is missing**

Run:

```bash
npm test -- server/api/zalo-bot/chat/capabilities/capabilityMetrics.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement the typed metric event and sink**

Create `server/api/zalo-bot/chat/capabilities/capabilityMetrics.ts`:

```ts
import {
  isZaloBotCapabilityName,
  type ZaloBotCapabilityName,
} from '../../../../../shared/zaloBotCapabilities.js';
import {
  isZaloBotStaffRole,
  type ZaloBotStaffRole,
} from '../../../../../shared/zaloBot.js';
import {
  ZALO_BOT_CAPABILITY_GATE_DENIALS,
  type ZaloBotCapabilityGateDenial,
} from './capabilityGates.js';

export const ZALO_BOT_CAPABILITY_METRIC_EVENTS = [
  'classifier_success',
  'classifier_fallback',
  'classifier_low_confidence',
  'entity_disambiguation',
  'entity_no_match',
  'read_succeeded',
  'read_failed',
  'preview_created',
  'preview_expired',
  'preview_cancelled',
  'preview_stale',
  'confirmation_invalid',
  'confirmation_duplicate',
  'mutation_succeeded',
  'mutation_failed',
  'receipt_delivery_failed',
  'receipt_delivery_ambiguous',
  'notification_queued',
  'notification_delivered',
  'notification_failed',
  'authorization_denied',
  'feature_gate_denied',
] as const;

export type ZaloBotCapabilityMetricEvent =
  (typeof ZALO_BOT_CAPABILITY_METRIC_EVENTS)[number];

export type ZaloBotCapabilityMetricInput = {
  event: ZaloBotCapabilityMetricEvent;
  capability?: ZaloBotCapabilityName;
  role?: ZaloBotStaffRole;
  gateReason?: ZaloBotCapabilityGateDenial;
  durationMs?: number;
};

export type ZaloBotCapabilityMetric = ZaloBotCapabilityMetricInput & {
  component: 'zalo_bot_capability';
  timestamp: string;
};

export function createZaloBotCapabilityMetric(
  input: ZaloBotCapabilityMetricInput,
  now: () => string = () => new Date().toISOString()
): ZaloBotCapabilityMetric {
  if (!(ZALO_BOT_CAPABILITY_METRIC_EVENTS as readonly string[]).includes(input.event)) {
    throw new Error(`Unknown capability metric event: ${String(input.event)}`);
  }
  if (input.capability !== undefined && !isZaloBotCapabilityName(input.capability)) {
    throw new Error(`Unknown capability metric capability: ${String(input.capability)}`);
  }
  if (input.role !== undefined && !isZaloBotStaffRole(input.role)) {
    throw new Error(`Unknown capability metric role: ${String(input.role)}`);
  }
  if (
    input.gateReason !== undefined &&
    !(ZALO_BOT_CAPABILITY_GATE_DENIALS as readonly string[]).includes(input.gateReason)
  ) {
    throw new Error(`Unknown capability metric gate reason: ${String(input.gateReason)}`);
  }
  if (
    input.durationMs !== undefined &&
    (!Number.isFinite(input.durationMs) || input.durationMs < 0)
  ) {
    throw new Error('Capability metric duration must be a non-negative finite number');
  }
  return {
    component: 'zalo_bot_capability',
    event: input.event,
    ...(input.capability === undefined ? {} : { capability: input.capability }),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.gateReason === undefined ? {} : { gateReason: input.gateReason }),
    ...(input.durationMs === undefined ? {} : { durationMs: Math.round(input.durationMs) }),
    timestamp: now(),
  };
}

export function emitZaloBotCapabilityMetric(
  input: ZaloBotCapabilityMetricInput,
  options: {
    sink?: (label: string, metric: ZaloBotCapabilityMetric) => void;
    now?: () => string;
  } = {}
): void {
  const metric = createZaloBotCapabilityMetric(input, options.now);
  const sink = options.sink ?? ((label, value) => console.info(label, value));
  sink('[zalo-bot-capability-metric]', metric);
}
```

- [ ] **Step 4: Document safe defaults and the Foundation boundary**

Append after `ZALO_BOT_CHAT_ENABLED` in `.env.example`:

```dotenv
# Capability Registry foundation. Keep audience=none until a reviewed pilot rollout.
ZALO_BOT_CAPABILITY_REGISTRY_ENABLED=false
ZALO_BOT_WRITE_ENABLED=false
ZALO_BOT_ROLES_ENABLED=teacher,office,admin
ZALO_BOT_CAPABILITIES_ENABLED=
ZALO_BOT_CAPABILITY_AUDIENCE=none
ZALO_BOT_CAPABILITY_PILOT_UIDS=
```

Update `docs/zalo-bot-runbook.md` so the opening role list includes accounting as a linkable role, then add a section after “Hỏi đáp AI” containing these exact operator rules:

````markdown
## Capability Registry Foundation

Foundation deployment does not enable a new read or write. Accounting staff may link and receive link confirmations or admin test messages, but the legacy chat and daily digest remain limited to teacher, office, and admin.

Keep the production rollout closed after deploy:

```dotenv
ZALO_BOT_CAPABILITY_REGISTRY_ENABLED=false
ZALO_BOT_WRITE_ENABLED=false
ZALO_BOT_ROLES_ENABLED=teacher,office,admin
ZALO_BOT_CAPABILITIES_ENABLED=
ZALO_BOT_CAPABILITY_AUDIENCE=none
ZALO_BOT_CAPABILITY_PILOT_UIDS=
```

An audience of `pilot` requires at least one UID. Unknown role, capability, audience, or boolean values make configuration loading fail closed. Enabling the registry alone still enables nothing unless the role, capability, and audience gates also match.

Rollback Foundation by setting `ZALO_BOT_CAPABILITY_REGISTRY_ENABLED=false` and `ZALO_BOT_WRITE_ENABLED=false`. Do not delete links or message ledgers. Existing webhook, linking, chat, and digest continue through their established paths.
````

- [ ] **Step 5: Run the complete Foundation verification suite**

Run:

```bash
npm test -- shared/zaloBot.test.ts shared/zaloBotCapabilities.test.ts api/zalo-bot/action.test.ts server/api/zalo-bot src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx
npm run typecheck
npx eslint shared/zaloBot.ts shared/zaloBotCapabilities.ts server/api/zalo-bot/config.ts server/api/zalo-bot/routeHandler.ts server/api/zalo-bot/linkHandlers.ts server/api/zalo-bot/digestSources.ts server/api/zalo-bot/chat/chatService.ts server/api/zalo-bot/chat/answerComposer.ts server/api/zalo-bot/chat/responseComposer.ts server/api/zalo-bot/chat/capabilities src/components/zalo/ZaloBotLinkCard.tsx
git diff --check
```

Expected: Vitest reports zero failures, TypeScript exits 0, ESLint exits 0, and `git diff --check` prints nothing.

- [ ] **Step 6: Verify no production gate was enabled**

Run:

```bash
rg -n '^ZALO_BOT_(CAPABILITY_REGISTRY_ENABLED|WRITE_ENABLED|ROLES_ENABLED|CAPABILITIES_ENABLED|CAPABILITY_AUDIENCE|CAPABILITY_PILOT_UIDS)=' .env.example
git diff -- .env.example docs/zalo-bot-runbook.md
```

Expected: `.env.example` shows registry `false`, write `false`, roles `teacher,office,admin`, empty capability/pilot lists, and audience `none`; the runbook contains no credential or production `.env` value.

- [ ] **Step 7: Commit metrics and operations documentation**

```bash
git add server/api/zalo-bot/chat/capabilities/capabilityMetrics.ts server/api/zalo-bot/chat/capabilities/capabilityMetrics.test.ts .env.example docs/zalo-bot-runbook.md
git commit -m "chore: add Zalo capability metrics and rollout docs"
```

## Final Acceptance Check

After all six task commits, run:

```bash
git status --short
git log -6 --oneline
npm test -- shared/zaloBot.test.ts shared/zaloBotCapabilities.test.ts api/zalo-bot/action.test.ts server/api/zalo-bot src/components/zalo/ZaloBotLinkCard.test.tsx src/pages/common/Profile.zaloBot.test.tsx
npm run typecheck
```

Expected:

- Only pre-existing ignored/untracked workspace artifacts may remain; no planned source file is uncommitted.
- Six new implementation commits are present after the design/plan commits.
- All focused Foundation tests pass with zero failures.
- TypeScript exits 0.
- No capability is registered into the live chat coordinator and no mutation path exists.
- Accounting can link, receive confirmation/test delivery, and appears in admin overview.
- Accounting remains ineligible for legacy AI chat and absent from daily digest recipients.
