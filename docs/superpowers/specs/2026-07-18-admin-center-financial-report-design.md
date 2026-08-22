# Admin Center Financial Report ("Báo cáo trạng thái tài chính trung tâm")

## Purpose

The admin dashboard's **"Báo cáo quỹ"** card (`src/pages/admin/AdminOverviewTab.tsx`) shows only three
numbers — total income, total expenses, balance — over a date range, and it is **not clickable**. An
admin cannot drill from it into the center's full financial picture.

This feature makes the card open a dedicated report page that answers, per month:

- **Doanh thu dự kiến** (projected revenue) — derived from the whole center's receivables (công nợ).
- **Doanh thu thực tế** (actual revenue) — from posted receipts (phiếu thu).
- **Giảm giá** (discounts) and **Miễn giảm** (waivers) — how much of the billed fee was reduced, split
  by kind.
- **Đã thu / Đã chi** (collected / spent) and the resulting fund balance.
- The above visualized with charts (waterfall, 12-month trend, category pies, receivables by status).

The building blocks already exist: `course_fee_ledgers` holds per-student receivables, `shared/money.ts`
and `shared/studentFinanceReport.ts` already encode the ledger math, receipts already carry
`discountType`, and the app already uses `recharts` + custom SVG charts. The main new work is a
**center-wide monthly aggregation** and the **report screen**.

## Decisions Locked With Product Owner

1. **Location: a dedicated page.** The card links to a new route `/admin/finance-report`
   (`src/pages/admin/FinanceReport.tsx`), following the existing `/admin/staff-password-resets`
   sub-page pattern. Not a modal, not the accounting `ReportTab`.
2. **Headline "Doanh thu dự kiến" = net.** Projected revenue is the amount that should actually be
   collected after discount & waiver = **collected + outstanding** (net billed). The full waterfall
   (gross → discount → waiver → net → collected → outstanding) is still shown; this only decides the
   highlighted number.
3. **Discount vs waiver split:**
   - **Giảm giá (discount)** = `discountType ∈ {first_prize, second_prize, custom}` + the
     `siblingDiscount` portion (merit / commercial reductions).
   - **Miễn giảm (waiver)** = `discountType ∈ {full_waiver, hardship}` (full/hardship exemptions).
4. **Monthly framing.** Receivable numbers are computed **per month** ("doanh thu dự kiến của trung
   tâm trong tháng đó"), not as one all-time snapshot.
5. **Month attribution of a ledger's billed amount:** the **cohort month**.
   - `periodType: 'monthly'` ledger → its `month` field (`YYYY-MM`).
   - `periodType: 'course'` ledger → the month of `termStart`; fallback to `createdAt` month if
     `termStart` is empty.

## Current System Context

| Layer | Location |
| --- | --- |
| Dashboard card (to make clickable) | `src/pages/admin/AdminOverviewTab.tsx` (fund card ~L348–381 and ~L689–741) |
| Dashboard data hook | `src/pages/admin/hooks/useAdminDashboardData.ts` (`fundReport`, `handleLoadFundReport`) |
| Route registration | `src/app/AnimatedRoutes.tsx` (lazy imports) |
| Client finance API | `src/lib/api/financeApi.ts` (`FinanceReport`, `fetchFinanceReport`) |
| Serverless action router | `api/finance/[action].ts` (`action === 'report'` branch) |
| Existing report handler | `server/api/finance/handlers/report.ts` (`handleReport`, gated `['admin','accounting']`) |
| Existing report service | `server/api/lib/services/financeReportService.ts` (`buildFinanceReport`, `aggregateFinanceReport`) |
| Finance repository | `server/api/lib/repositories/financeRepository.ts` (`FinanceRepository`, doc cap 5000) |
| Ledger math (pure) | `shared/money.ts` (`ledgerAmount/paidTotal/discountTotal/remaining`) |
| Ledger status/balance (pure) | `shared/studentFinanceReport.ts` (`calculateLedgerBalance`, `deriveLedgerDisplayStatus`) |
| Domain types | `src/types/finance.ts` (`CourseFeeLedger`, `Receipt`, `Expense`, `DiscountType`) |
| Ledger creation | `server/api/classes/helpers/classHelpers.ts:493` (`generateCourseFeeLedgers`) |
| Chart components | `src/components/charts/ReportCharts.tsx`; `recharts` usage in `src/pages/accounting/components/ReportTab.tsx` |
| i18n | `src/lib/i18n/locales/vi/pages.ts`, `.../en/pages.ts` |
| Firestore indexes | `firestore.indexes.json` |

### Relevant field shapes (from `src/types/finance.ts`)

- **`CourseFeeLedger`**: `amount` (gross fee), `paidTotal`, `discountTotal?`, `status`
  (`unpaid|partial|paid|waived`), `periodType? ('course'|'monthly')`, `month?`, `termStart?`,
  `termEnd?`, `dueDate?`, `createdAt`, `classId`, `studentId`.
- **`Receipt`** (`status: 'draft'|'posted'|'void'`): `amountReceived`, `receivedDate`, `ledgerId`,
  `classId`, `discountType?`, `siblingDiscount?`, `discountAmount?`, `discountPercent?`.
- **`Expense`** (`status`): `amount`, `paidDate`, `category`.
- **`DiscountType`** = `none | first_prize | second_prize | full_waiver | hardship | custom`.

## Data Model & Formulas (core)

Two accounting lenses are combined and **labeled distinctly** to avoid confusion:

- **Receivable side = accrual**, attributed to a ledger's **cohort month** (Decision 5).
- **Cash side (fund) = cash**, attributed to the transaction date (`receivedDate` / `paidDate`).

### Cohort month of a ledger

```
cohortMonth(ledger):
  if periodType == 'monthly' and ledger.month matches /^\d{4}-\d{2}$/ -> ledger.month
  else if ledger.termStart is a date        -> ledger.termStart.slice(0,7)
  else                                       -> ledger.createdAt.slice(0,7)
```

### Per-month receivable waterfall (from `course_fee_ledgers` of that cohort month)

Uses the pure helpers in `shared/studentFinanceReport.ts` / `shared/money.ts`. No cross-collection
join needed — all five numbers come from the ledgers themselves:

| Row | Formula | Source helper |
| --- | --- | --- |
| Học phí gốc (gross) | Σ `ledger.amount` | `ledgerAmount` |
| (−) Tổng giảm trừ | Σ `ledger.discountTotal` | `ledgerDiscountTotal` |
| **= Doanh thu dự kiến (net)** ★ | gross − discountTotal | `calculateLedgerBalance().netAmount` |
| (−) Đã thu (cohort) | Σ `min(paidTotal, netAmount)` | `calculateLedgerBalance().paid`, capped at net |
| **= Công nợ còn lại (outstanding)** | Σ `max(0, amount − discountTotal − paidTotal)` | `ledgerRemaining` |

> **Reconciliation invariant:** collected is **capped at net per ledger** (`min(paid, net)`) so that
> `netBilled − collectedCohort === outstanding` holds even when `paidTotal > net` (overpayment / legacy
> anomaly). Overpayment is not revenue and must not inflate the collected bar; actual cash received is
> reported separately as `cashIn` (receipts). The waterfall chart relies on this invariant.

### Discount vs waiver split (from `receipts`, for the selected month — a SEPARATE panel, not part of the waterfall)

`ledger.discountTotal` records the *amount* of a reduction but not its *kind*, so the giảm/miễn split
is aggregated from receipts, which carry `discountType`:

```
giảm giá     = Σ receipt.discountAmount where discountType ∈ {first_prize, second_prize, custom}
miễn giảm    = Σ receipt.discountAmount where discountType ∈ {full_waiver, hardship}
chưa phân loại = Σ receipt.discountAmount where discountType is anything else (non-zero amount)
```

`siblingDiscount` is a 10% flag whose value is already folded into `discountAmount`; it is counted
under **giảm giá** (its `discountType` is one of the discount kinds, never `full_waiver`).

**Basis and consistency (locked after review):** this split is **receipt-based, by `receivedDate`
month** (cash) and is shown as its own labeled panel/KPIs. It is deliberately **NOT** fed into the
receivable waterfall, because the waterfall is entirely **ledger cohort-based** (accrual). Mixing a
receipt-date split into a cohort waterfall makes the bars fail to reconcile (receipt discounts for a
cohort can be posted in a later month). The waterfall therefore uses one aggregate **"Tổng giảm trừ" =
Σ `ledger.discountTotal`** step; the giảm/miễn breakdown answers "of the reductions *recorded on
receipts this month*, how much was discount vs waiver" and is labeled as such. `unclassified` catches
receipts whose `discountType` is unrecognized so nothing is silently dropped.

### Cash flow (reuse existing report logic)

- **Đã thu (thực tế)** = Σ `receipts.amountReceived` where `status == 'posted'`, by `receivedDate`
  month = existing `totalIncome`.
- **Đã chi** = Σ `expenses.amount` where `status == 'posted'`, by `paidDate` month = existing
  `totalExpenses`.
- **Số dư quỹ** = đã thu − đã chi.
- `incomeByLevel` and `expensesByCategory` reuse the existing breakdowns verbatim.

> **Accrual vs cash note (for the spec reader and UI footnote):** "Đã thu (cohort)" in the waterfall
> (Σ `paidTotal` of a month's ledgers) and "Đã thu (thực tế)" in the cash flow (receipts by
> `receivedDate`) answer different questions and **will differ per month** (a receipt in July can pay
> off a May cohort's debt). They reconcile only in aggregate over all time. The UI must label both
> clearly.

### Receivables by status (for the status chart)

Per ledger, `deriveLedgerDisplayStatus(ledger, todayStr)` yields `waived | paid | overdue | partial |
unpaid | due_date_missing`. Aggregate outstanding amount and ledger count per status across the
selected month's cohort (or the full open book — see Open Question O1).

## Backend Design

### New endpoint

`GET /api/v1/finance/center-report?month=YYYY-MM&months=N`

- New branch `action === 'center-report'` in `api/finance/[action].ts`, delegating to a new
  `handleCenterReport` (`server/api/finance/handlers/centerReport.ts`), gated `['admin','accounting']`
  via `verifyAuthToken` exactly like `handleReport`.
- Deliberately **separate** from `/report` so the accounting `ReportTab` response shape is untouched
  and the extra ledger reads only happen for this screen.
- Params: `month` (default = current month in `Asia/Ho_Chi_Minh`; invalid calendar months return
  `400 invalid_month`), `months` (trend length, default 12, clamp e.g. 1–24).

### New service `server/api/lib/services/centerFinanceReportService.ts`

Responsibilities:

1. Resolve the month window: the selected `month` plus the prior `months−1` months for the trend.
2. Load ledgers whose cohort month falls in the window (see repository additions), plus **one
   snapshot each** of receipts and expenses for the same window. Derive selected-month rows from
   those arrays in memory so cash totals, categories, and discount splits cannot disagree within one
   response; reuse `FinanceRepository.listPostedReceipts/Expenses`.
3. Compute, using the pure `shared/` helpers:
   - per-month receivable waterfall (gross, discountTotal, net, collected, outstanding),
   - period-level giảm/miễn split from receipts,
   - per-month cash income/expenses (reuse `aggregateFinanceReport`),
   - `incomeByLevel`, `expensesByCategory`,
   - receivables-by-status for the selected month.
4. Return a typed `CenterFinanceReport` (see Response shape).

### Repository additions (`financeRepository.ts`)

- `listLedgersByCohortMonths(months: string[]): Promise<FinanceLedgerRow[]>` returning
  `{ id, amount, paidTotal, discountTotal, status, periodType, month, termStart, termEnd, dueDate,
  createdAt, classId }`. **Three** single-field queries, unioned/deduped by doc id:
  - Monthly ledgers: `where('month', 'in', monthsChunk)` (chunk `in` to ≤30).
  - Course ledgers: `where('termStart', '>=', windowStartDate).where('termStart', '<=',
    windowEndDate + '')`, then filter to the requested cohort months in memory.
  - Orphan course ledgers: `where('termStart', '==', '')` — recovers ledgers whose class had no
    `startDate` (generator writes `termStart: ''`), attributed by `createdAt` month in the pure module
    and cohort-filtered there.
  - Apply the same `MAX_REPORT_DOCS_PER_COLLECTION` (5000) cap + `ReportRangeTooLargeError` guard on the
    **merged** result. **Tradeoff:** the orphan query is not windowed, so if orphan ledgers ever exceed
    the cap the report 413s for *every* month until the data is cleaned up — acceptable while orphans
    are a rare exception (a class with no start date); revisit with a `cohortMonth` backfill if they
    become common.
- Reuse `getClassLevelMap()` for `incomeByLevel`.

### Aggregation strategy

**Live, month-scoped aggregation per request.** The existing `finance_monthly_aggregates` cache is
**not** reused for collected/outstanding, because a late payment mutates a *past* cohort's collected &
outstanding, so those fields are not safe to cache once a month closes. Gross/discount/net for a closed
cohort are stable, but caching only part of the waterfall adds complexity for little gain. Pre-aggregation
via cron/triggers is **out of scope** (see Out of Scope).

### Response shape (`CenterFinanceReport`)

```ts
type CenterMonth = {
  month: string;            // YYYY-MM
  grossBilled: number;      // Σ amount
  discountTotal: number;    // Σ discountTotal
  netBilled: number;        // dự kiến (gross − discountTotal)
  collectedCohort: number;  // Σ min(paidTotal, netAmount) — capped at net (accrual); see invariant
  outstanding: number;      // công nợ
  cashIn: number;           // receipts by receivedDate (cash)
  cashOut: number;          // expenses by paidDate (cash)
};

type CenterFinanceReport = {
  success: true;
  selectedMonth: string;
  months: CenterMonth[];                 // trend, ascending
  current: CenterMonth;                  // selectedMonth's row (headline source)
  discountBreakdown: {                   // period-level split
    discount: number;                    // giảm giá
    waiver: number;                      // miễn giảm
    unclassified: number;                // receipts with an unrecognized discountType (non-zero amount)
  };
  incomeByLevel: Array<{ level: string; label: {vi:string;en:string}; amount: number }>;
  expensesByCategory: Array<{ category: string; label: {vi:string;en:string}; amount: number }>;
  receivablesByStatus: Array<{ status: string; count: number; outstanding: number }>;
  source: 'live';
};
```

Client mirror added to `src/lib/api/financeApi.ts`: `CenterFinanceReport` type +
`fetchCenterFinanceReport(month, months)`.

## Frontend Design

### Route & entry point

- Register `FinanceReport` lazily in `src/app/AnimatedRoutes.tsx`; add a route guarded with
  `ProtectedRoute requiredRole="admin"` (matching `/admin/staff-password-resets`).
- In `AdminOverviewTab.tsx`, add `to="/admin/finance-report"` to the **visible** fund card only —
  the `AdminMetricCard` at ~L348, which already renders as a `<Link>` when `to` is set. The second
  fund block (~L689) lives inside a `<div className="hidden">` container (dead/hidden UI) and is **not
  made clickable** (YAGNI — users never see it).

### `src/pages/admin/FinanceReport.tsx`

- **Controls:** month picker (default current month) **and a trend-length selector** (e.g. 6/12/24
  months, default 12) — both feed `fetchCenterFinanceReport(month, months)`. Request state is keyed by
  `month:months`; while a new key is loading, the previous report is hidden so controls never label stale
  figures as the newly selected period. States: loading / empty / `report_too_large` (413). The client
  must **preserve `errorCode`** from the 413 body so the page can show the "range too large" message
  rather than a generic error.
- **KPI card row** (from `current`): Doanh thu dự kiến (netBilled) · Đã thu (cashIn) · Công nợ còn lại
  (outstanding) · Giảm giá · Miễn giảm · Đã chi (cashOut) · Số dư quỹ (cashIn − cashOut). The Giảm
  giá / Miễn giảm cards are labeled as **receipt-based for the selected month** (see the split panel).
- **Charts:**
  1. **Waterfall (ledger cohort-based, self-consistent)** — Học phí gốc → −Tổng giảm trừ
     (`discountTotal`) → Dự kiến (net) → −Đã thu (cohort) → Công nợ. It uses only `current`
     ledger figures so the bars always reconcile.
  2. **Discount/waiver split** — a small labeled panel (two bars or the two KPI cards) from
     `discountBreakdown` (receipt-based, by receivedDate month), kept **separate** from the waterfall.
  3. **Trend** — 6/12/24-month bar/line of netBilled vs cashIn vs cashOut; axis labels use `MM/YY`
     so a 24-month range never repeats ambiguous month-only labels.
  4. **Pies/bars** — thu theo cấp học (`incomeByLevel`), chi theo hạng mục (`expensesByCategory`).
  5. **Receivables by status** — `receivablesByStatus` (unpaid/partial/overdue/…), showing both
     outstanding amount and ledger count (tooltip plus visible count summary).
- Reuse `recharts` and `src/components/charts/ReportCharts.tsx`; match the theme-aware styling already
  used by `ReportTab.tsx`.
- Split into focused sub-components (KPI row, each chart) so the page file stays small and testable.

## Cross-cutting

- **i18n:** add vi/en keys under the pages locale files for the new page (labels, KPI names, chart
  titles, the accrual-vs-cash footnote, discount/waiver names).
- **Firestore indexes:** **no new composite index required.** The ledger queries are single-field
  (`month` `in`, `termStart` range), covered by Firestore's automatic single-field indexes. Add a
  composite index only if a future query combines fields (e.g. `status` + range).
- **Field normalization & query completeness:** `course_fee_ledgers.createdAt` is a Firestore
  **Timestamp**, not a string — the repository normalizes it (Timestamp → ISO date string) when
  building rows so the `ledgerCohortMonth` fallback works. **Caution:** a class's `startDate` is
  *optional* (`validations.ts`), and the ledger generator writes `termStart = String(startDate || '')`
  (`classHelpers.ts:525`), so course ledgers can have `termStart: ''`. Those are missed by both the
  `month in` and `termStart` range queries, so the repository adds a **third query** `where('termStart',
  '==', '')` to recover them, attributing by `createdAt` month. All three are single-field queries (no
  composite index), and the doc cap is enforced on the **merged** result.
- **Rules:** no client rule change — data is read through the admin/accounting-gated API. Confirm the
  endpoint rejects other roles (test).
- **Tests:**
  - Service unit tests (`centerFinanceReportService`): waterfall math, discount/waiver split (incl.
    unclassified), cohort-month attribution (monthly `month` vs course `termStart` vs Timestamp
    `createdAt`), `full_waiver` edge (amountReceived 0), empty period.
  - Repository test for month-window ledger query, id-dedup, and the merged-result doc-cap guard.
  - Endpoint permission test: `verifyAuthToken` called with `['admin','accounting']`; a rejected user
    yields 403 and the service is not invoked.
  - Component tests: `FinanceReport` renders KPIs from a fixture; each chart asserts its title and data
    labels (with `ResponsiveContainer` mocked to a fixed size). The charts that have an empty state
    (category-by-level/category, receivables-by-status) also assert it; the waterfall and trend always
    render from `current`/`months`, so they have no empty state.

## Out of Scope (YAGNI)

- PDF/Excel export.
- Pre-aggregation / cron / event-driven cache for receivables.
- Any change to receipt/expense/ledger data entry flows.
- Per-month discount/waiver split inside the trend chart (period-level split only).

## Decided During Review

- **O1 — Receivables-by-status scope: selected month's cohort** (consistent with the rest of the
  month-centric page). Implemented by feeding only the selected month's cohort ledgers into the status
  aggregation. **Note:** switching to the *entire open book* is not a one-line change — the service
  only loads the trend window (12/24 months) of ledgers, so an open-book view needs a **separate
  repository query** over the *stored* status (e.g. `where('status','in',['unpaid','partial'])` —
  `overdue` is a derived display status, not a stored field, so it cannot be queried) rather than
  reusing the windowed `ledgers` array.
