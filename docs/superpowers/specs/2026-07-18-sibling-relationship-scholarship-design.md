# Sibling Relationship & Sibling Scholarship ("Quan hệ anh em & học bổng anh em")

## Purpose

The center gives a **10% sibling scholarship (học bổng anh em)** to students who have a sibling
studying at the center. Today this exists only as a **manual checkbox** in the receipt modal
(`src/components/finance/ReceiptModal.tsx:76`): accounting must remember which students are siblings
and tick the box by hand. Nothing in the data model records the relationship, and the server accepts
the flag without verification (`server/api/finance/handlers/receipts.ts:126`).

This feature makes the relationship **first-class data** and the scholarship **derived from it**:

- A student can be linked to their siblings via a stored relationship.
- Searching a student's name also surfaces their siblings in the results.
- When accounting issues a receipt, the sibling scholarship is **applied by default**, decided by the
  server, not by the operator's memory.
- The scholarship is **only valid while at least two members of the group are actively enrolled**. If
  a sibling goes on leave, drops, or is archived, the remaining lone student loses it.

## Decisions Locked With Product Owner

1. **Every sibling gets 10%.** Not "second child onwards", not a tiered ladder. Each eligible student
   receives 10% off their own tuition. This matches how the existing checkbox already behaves.
2. **"Active" = `studentLifecycle === 'enrolled'` AND `enrollmentStatus === 'active'`** (strictest
   option). Trial, `on_leave`, `dropped`, `promoted`, and `archived` all fail the test.
3. **A group stays eligible while ≥ 2 members are active.** For a 3-sibling group A-B-C where C is
   archived, A and B keep the scholarship; C does not. The scholarship is lost only when a student is
   the last active member of their group.
4. **Accounting may waive the auto-applied scholarship, but must record a reason.** They cannot add
   it when the server says the student is ineligible.
5. **Data model: a single `siblingGroupId` field on `Student`.** A group is the set of students
   sharing the id. No separate collection. See "Data Model Rationale".
6. **Siblings appear in search as their own indented row**, labelled "anh/em của {name}", directly
   beneath the directly-matching student.
7. **No retroactive recalculation.** Eligibility is evaluated when the receipt is issued and frozen
   into it. Posted receipts never change because a sibling's status later changed.
8. **The 10% entitlement is per ledger, not per receipt.** A ledger collected in instalments
   receives 10% in total, tracked by `siblingDiscountTotal` on the ledger.
9. **The sibling portion is stored on the receipt** as `siblingDiscountAmount`, so the finance
   report can classify it separately from a waiver it stacks onto.
10. **`custom` stacks like every other discount type.** No exception.

## Current System Context

| Layer | Location |
| --- | --- |
| Student domain type | `src/types/student.ts` (`Student`, `EnrollmentStatus`, `StudentLifecycle`) |
| Receipt domain type | `src/types/finance.ts` (`Receipt`, `DiscountType`, `siblingDiscount`) |
| Receipt UI (manual checkbox today) | `src/components/finance/ReceiptModal.tsx` (`siblingDiscount` state L76; +10% math L146, L176) |
| Receipt creation (server) | `server/api/finance/handlers/receipts.ts` — **two paths**: `create-and-post` (L28) and `create` (L233) |
| Receipt request validation | `server/api/lib/validation/validations.ts:232` (`createReceiptSchema`) |
| Student directory hook | `src/lib/student/useStudentDirectoryData.ts:74` (`paginationMode`) |
| Student list + search UI | `src/pages/common/Students.tsx` (`filteredStudents` L252, `highlightMatch` L516/L538) |
| Student index read API | `src/lib/api/studentDirectoryApi.ts`; `server/api/read/handlers` |
| Student mutation authz | `server/api/students/handlers/status.ts:64` (`admin` + `office` only) |
| Student profile (Student 360) | `src/pages/common/StudentOverviewTab.tsx`, `src/pages/common/StudentProfilePage.tsx` |
| Center finance report split | `shared/centerFinanceReport.ts:206-222` (`splitDiscounts`) |
| Shared pure-logic convention | `shared/money.ts`, `shared/studentFinanceReport.ts`, `shared/centerFinanceReport.ts` |
| Audit trail | `src/types/audit.ts` (`AuditLogEntry` with `collection`/`documentId`/`changes`) |
| i18n | `src/lib/i18n/locales/{vi,en}/{pages,components}.ts` |

### Constraint discovered during design

`useStudentDirectoryData.ts:74` sets `paginationMode = isAccounting ? 'server' : 'client'`.
**Accounting — the role that most needs this feature — is the one role that does not hold the full
student list client-side.** Sibling expansion therefore cannot be a purely client-side grouping; see
"Search".

## Data Model

Add one optional field to `Student` (`src/types/student.ts`):

```ts
siblingGroupId?: string;   // sibling group = all students sharing this id
```

Add three optional fields to `Receipt` (`src/types/finance.ts`):

```ts
siblingDiscountAmount?: number;          // the sibling portion of discountAmount, in dong
siblingDiscountWaived?: boolean;         // accounting explicitly declined the auto scholarship
siblingDiscountWaivedReason?: string;    // required when the above is true
```

Add one optional field to `CourseFeeLedger` (`src/types/finance.ts`):

```ts
siblingDiscountTotal?: number;           // sibling scholarship already granted on this ledger
```

`siblingDiscount?: boolean` keeps its current meaning: "the 10% sibling scholarship was applied to
this receipt". `discountAmount` remains the **total** reduction on the receipt;
`siblingDiscountAmount` is the part of it attributable to the sibling scholarship.

### Why the sibling portion is stored separately

`discountAmount` blends every reduction on a receipt into one number. Two requirements make that
insufficient:

1. **A ledger can be collected in instalments.** Each receipt would otherwise recompute 10% of the
   full fee, so a course paid in three receipts would receive 30%. `siblingDiscountTotal` on the
   ledger records what has already been granted, and each receipt grants only the shortfall against
   `10% × ledger.amount`.
2. **The sibling scholarship stacks onto a waiver.** A hardship receipt (20%, a *miễn giảm*) plus
   the sibling scholarship (10%, a *giảm giá*) produces a single `discountAmount` that the finance
   report must split across two different categories. Only a stored sibling component can do that.

### Data Model Rationale

Three options were weighed:

1. **`siblingGroupId` on `Student` (chosen).** A sibling group is an *equivalence class* — "same
   family" is reflexive, symmetric, and transitive. A shared group id represents exactly that, by
   construction. There is no way to store an inconsistent state, no join needed on read (the client
   already holds students; grouping is a scan), and membership changes are single-field writes.
2. **`siblingGroupId` + a `siblingGroups` collection.** Adds room for group metadata (family name,
   note) at the cost of keeping two places in sync via transactions, plus new Firestore rules and a
   new read path. No current requirement justifies that cost. Upgrading later is additive — the read
   path stays as-is.
3. **A `siblingIds[]` array per student (rejected).** Pairwise links are **not transitive**: given
   A-B and B-C, whether A and C are siblings has no stored answer, and either interpretation produces
   wrong money. Every mutation also has to write two documents atomically or the graph goes
   asymmetric.

### Invariant

**A group never has exactly one member.** When a removal would leave a single student in a group,
that student's `siblingGroupId` is cleared in the same transaction. A one-member group is meaningless
and would leave data that reads as "has siblings but ineligible", misleading both the UI and reports.

## Eligibility Rule

New shared module `shared/siblingScholarship.ts`, imported by **both** client and server — the same
convention `shared/centerFinanceReport.ts` already follows — so the money rule exists exactly once.

```ts
export const SIBLING_DISCOUNT_PERCENT = 10;

export function isActiveForSibling(s: StudentLike): boolean {
  return s.studentLifecycle === 'enrolled' && s.enrollmentStatus === 'active';
}

export function isSiblingScholarshipEligible(student: StudentLike, pool: StudentLike[]): boolean {
  if (!student.siblingGroupId) return false;
  if (!isActiveForSibling(student)) return false;
  const activeMembers = pool.filter(
    (s) => s.siblingGroupId === student.siblingGroupId && isActiveForSibling(s)
  );
  return activeMembers.length >= 2;   // counts `student` itself
}
```

The three clauses express the locked rules exactly: the student must be studying, and at least one
other group member must also be studying.

| Scenario | Result |
| --- | --- |
| A active, B active | Both eligible |
| A active, B archived | **Neither** eligible (A is the last active member) |
| A active, B active, C archived | A and B eligible; C not |
| A active, B on leave | Neither eligible |
| A active, no `siblingGroupId` | Not eligible |
| A trial, B active | Neither eligible (A fails; B is then the last active member) |

## Receipt Flow

**The server decides; the client only previews.** The client still computes the discount so the
operator sees the amount before saving, but `server/api/finance/handlers/receipts.ts` does not trust
the incoming `siblingDiscount` flag. Inside the existing transaction it reads the student document
and queries group members by `siblingGroupId`, then evaluates `isSiblingScholarshipEligible`.
Querying inside a transaction is already established here (`receipts.ts:99` does `tx.get` on a
query).

| Client sends | Server evaluates | Outcome |
| --- | --- | --- |
| `siblingDiscount: true` | eligible, entitlement remaining | Grant the shortfall; store `siblingDiscount` + `siblingDiscountAmount` |
| `siblingDiscount: true` | **not** eligible | **Reject 400.** Data disagrees; never silently mis-bill |
| omitted / `false` | eligible, entitlement remaining | Grant the shortfall anyway |
| anything | eligible, entitlement already consumed | Grant 0; write no sibling fields |
| `siblingDiscountWaived: true` + reason | eligible | Store waiver + reason; grant 0 |
| `siblingDiscountWaived: true`, no reason | eligible | **Reject 400** (locked decision 4) |

The third row is what makes the scholarship "mặc định gán": an eligible student gets the discount
even if a client forgets to send the flag.

**The client's `discountAmount` covers only the base discount.** The server adds `siblingGrant`
itself rather than trusting the client to have folded it in — this is what makes the entitlement
cap enforceable, since only the server can read `ledger.siblingDiscountTotal`. A client that does
fold the 10% in would double-count it, so `ReceiptModal` sends the base figure and displays the
sibling line separately.

### The entitlement is enforced at post time

Four code paths touch a receipt's relationship to its ledger, and they do not all mutate it:

| Path | Ledger mutation today |
| --- | --- |
| `create-and-post` | increments `paidTotal` + `discountTotal` |
| `create` (draft) | **none** — only writes the receipt |
| `post` | increments `paidTotal` + `discountTotal` |
| `void` | decrements both |

Because a draft reserves nothing, computing the grant only at creation would let two drafts on one
ledger each claim the full 10% and then both post, yielding 20%. **The entitlement must therefore be
re-checked in `post`**, which already re-validates `discountAmount` against the ledger's remaining
balance (`receipts.ts:388-404`) — the same place, for the same reason.

- `create-and-post` and `post` increment `ledger.siblingDiscountTotal` by the receipt's
  `siblingDiscountAmount`, in the transaction that already updates `paidTotal` and `discountTotal`.
- `post` recomputes the entitlement first. If the draft's `siblingDiscountAmount` exceeds what is
  left, it is **clamped down** and the receipt's stored figures are corrected in the same
  transaction — the accountant should not have to redo a draft because a sibling's receipt was
  posted first. If clamping changes the amount, `amountReceived` is re-validated against the new
  balance and a genuine overpayment still errors.
- `void` decrements `siblingDiscountTotal` with a `Math.max(0, …)` floor, mirroring the existing
  `discountTotal` handling, so a corrected receipt can re-grant the entitlement.

**`full_waiver` overrides the whole table.** When `discountType === 'full_waiver'`, no sibling
scholarship is applied and no `siblingDiscount` field is written, regardless of eligibility or of
what the client sent — stacking on top of a 100% waiver is meaningless. This precedence is evaluated
**before** the rows above. The behaviour already exists at `receipts.ts:126` and
`ReceiptModal.tsx:136` and is preserved.

### Discount base and stacking

The 10% is **additive in percentage points** against the ledger's full amount, matching the existing
computation at `ReceiptModal.tsx:146` and `:176`:

```
siblingEntitlement = round(ledger.amount * 10 / 100)          // per ledger, not per receipt
siblingGrant       = max(0, siblingEntitlement - ledger.siblingDiscountTotal)
discountAmount     = baseDiscount + siblingGrant
```

So first prize (10%) plus sibling (10%) is **20% of the full fee**, not 10% compounded on the
already-discounted remainder.

**The entitlement is per ledger, not per receipt.** `siblingGrant` is the shortfall against the
ledger's lifetime 10% entitlement, so a course collected in three instalments still receives 10%
in total. The first receipt normally consumes the whole entitlement; later receipts on the same
ledger compute `siblingGrant = 0` and, having nothing to grant, write no sibling fields at all.

**`discountType: 'custom'` stacks like every other type.** The operator's figure is the
`baseDiscount` and the sibling grant is added on top. This keeps one rule for all discount types —
"the scholarship applies whenever the student is eligible" — rather than a silent exception the UI
would have to explain.

### Refactor: de-duplicate the discount block

`create-and-post` (L28) and `create` (L233) currently contain **near-identical copies** of the
discount computation (L79-139 vs L264-309). Adding the sibling check to both would make three copies
of one money rule. Extract a helper under `server/api/finance/handlers/` taking
`(ledger, body, student, groupMembers)` and returning `{ receiptDiscount, discountFields }`, and call
it from both paths. This is targeted cleanup in code the feature already has to touch.

## Bug Fixed As Part Of This Work

`splitDiscounts` (`shared/centerFinanceReport.ts:211`) classifies a reduction **solely** by
`discountType` and ignores `siblingDiscount` entirely. Meanwhile `ReceiptModal.tsx:211` only sets
`discountType` when it is not `'none'`. A receipt carrying **only** a sibling scholarship therefore
has no `discountType`, falls through to the `else` at L219, and is counted as **"chưa phân loại"**
instead of **"giảm giá"**.

This already contradicts the locked decision in
`docs/superpowers/specs/2026-07-18-admin-center-financial-report-design.md` (§3), which states the
`siblingDiscount` portion belongs under *giảm giá*. Today the case is rare because it requires
ticking sibling with no scholarship selected. Once the scholarship is automatic it becomes the
**most common** discount receipt, and the center finance report would under-report *giảm giá*.

**Fix:** split each receipt into its sibling component and its remainder, then classify each part:

```
siblingPart   = receipt.siblingDiscountAmount        → always "giảm giá"
remainderPart = discountAmount - siblingPart         → classified by discountType as today
```

A hardship receipt with a sibling scholarship therefore reports 10% under *giảm giá* and 20% under
*miễn giảm*, instead of pushing all 30% into one bucket. Classifying the whole receipt by the
sibling flag alone would be just as wrong as the current behaviour — it would relabel genuine
waivers as discounts.

Receipts written before this change carry no `siblingDiscountAmount`; their `siblingPart` is 0 and
they classify exactly as they do today, so historical figures do not shift.

## Search

One rule, two pipelines. New pure function in `shared/siblingScholarship.ts`:

```ts
expandWithSiblings(matched, pool) =>
  Array<{ student: StudentLike; matchKind: 'direct' | 'sibling'; siblingOf?: string }>
```

- **Client-paginated roles** (teacher, admin, office): `pool` is the in-memory student list. No extra
  request.
- **Accounting (server-paginated)**: the `read/students` handler collects the `siblingGroupId`s of
  the matched page, queries the additional members, and calls the same function.

Ordering, labelling, and de-duplication are then identical across roles; only the data source
differs.

**De-duplication:** a student who both matches directly and is someone's sibling appears **once**,
as `'direct'`. Without this, searching a common family name returns duplicated rows.

**Rendering** (`src/pages/common/Students.tsx`): sibling rows are indented beneath their originating
direct match, labelled "anh/em của {name}". Sibling rows must **not** run through `highlightMatch`
(L516/L538) — their name did not match the query, and highlighting would imply it did.

**Filters still win.** A sibling is pulled in only if it also satisfies the active class/status
filters. If accounting has filtered to Lớp 5A, a Lớp 3B sibling must not appear — the user stated
what they wanted to see.

## Relationship Management UI

A **"Anh chị em"** section on the student profile (Student 360). It lists group members with each
one's status, plus a line stating whether the scholarship is currently **in effect** and, when not,
why ("Bình đã lưu trữ").

Actions, executed server-side in a transaction:

| Action | Semantics |
| --- | --- |
| Link, neither has a group | Create a new id, assign to both |
| Link, one has a group | The other joins that group |
| Link, both in **different** groups | **Confirm first**, then merge. This joins two families and is a plausible mis-click — never merge silently |
| Unlink a member | Clear their `siblingGroupId`; if the group is left with one member, clear that member's id too (invariant) |

**Authorization:** `admin` + `office`, matching the existing student-mutation gate at
`server/api/students/handlers/status.ts:64`. Accounting can **see** the relationship and its effect
on tuition but cannot edit it — they consume the rule rather than set it.

**Audit:** relationship changes are written through the existing `AuditLogEntry` mechanism
(`action: 'update'`, `collection: 'students'`, `changes.siblingGroupId`). No feature-specific audit
store is needed.

## Testing

The pure functions in `shared/` carry every money decision, so that is where the weight goes.

| File | Cases |
| --- | --- |
| `shared/siblingScholarship.test.ts` | Two active members → eligible; A active + B archived → **both** ineligible; 3-member group losing one → remaining two still eligible; trial / `on_leave` / `dropped` / `promoted` → ineligible; missing `siblingGroupId` → ineligible; single-member group → ineligible |
| `shared/siblingScholarship.test.ts` (`expandWithSiblings`) | De-dup when a sibling also matches directly (kept as `'direct'`); sibling ordered immediately after its direct match; filtered-out siblings excluded |
| `server/api/finance` receipt tests | Client claims `true` while ineligible → 400; client omits the flag while eligible → server grants anyway; waiver without reason → 400; `full_waiver` → no sibling grant and no sibling fields; `custom` → sibling stacks on top of the operator figure; first prize + sibling → 20% of the full fee; both `create` and `create-and-post` paths |
| Entitlement cap | Second receipt on a ledger whose `siblingDiscountTotal` is already `10% × amount` grants 0 and writes no sibling fields; a partial first grant leaves the remainder available; `post` clamps a stale draft down to the remaining entitlement; `void` returns the entitlement |
| `shared/centerFinanceReport.test.ts` | Sibling-only receipt (no `discountType`) counts under **giảm giá**; hardship + sibling splits 10% into *giảm giá* and 20% into *miễn giảm*; a legacy receipt with no `siblingDiscountAmount` classifies exactly as before |
| Relationship mutation tests | Merge of two existing groups; unlink collapsing a 2-member group clears both ids; non-`admin`/`office` role rejected |

## Out Of Scope

- Inferring siblings automatically from the parent `contact` phone number — free-text and unreliable
  (changed numbers, separated parents); not a sound basis for money.
- Tiered rates by sibling count (2 siblings = 10%, 3 = 15%, …).
- Recalculating already-posted receipts when a sibling's status changes.
- Moving the scholarship percentage table server-side. The server currently accepts `discountAmount`
  from the client and only bounds-checks it (`receipts.ts:79-89`), so the *amount* of every discount
  kind is client-decided. This is pre-existing, affects all discount types equally, and fixing it
  means relocating `SCHOLARSHIP_OPTIONS` server-side — a separate piece of work. After this change
  the sibling **eligibility** is server-authoritative even though the amount is not.
