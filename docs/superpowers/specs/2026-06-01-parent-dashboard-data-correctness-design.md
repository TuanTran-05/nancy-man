# Parent Dashboard Data Correctness Design

## Goal

Fix the parent dashboard issues that can show fabricated or incorrectly scaled academic data, while keeping the change focused on the verified dashboard data paths.

## Scope

This design covers issues #1-#7 from the review:

- Stop fabricating radar "previous" values from the target score.
- Use the same fallback term label in visible labels and tooltips.
- Prevent evaluations from being counted in two adjacent terms.
- Treat persisted evaluation component scores as 0-100 values.
- Treat `finalScore` as a 0-100 value before converting to a 0-10 display.
- Avoid displaying legacy/inconsistent `totalScore` as `0.8/10` when 100-point component scores are available.
- Remove double rounding from term trend scores.

Issue #8 is out of scope because the current working tree still has the tests. Issues #9-#11 are lower-priority cleanup and should not block the correctness fix.

## Options Considered

### Option A: Minimal Hotfix

Fix only the most visible incorrect values: radar fallback and `<= 10` score inflation. This is fast, but it leaves double-counted term trend data and inconsistent score cards.

### Option B: Focused Correctness Pass

Fix #1-#7 together in the parent dashboard utilities and hook. This keeps the blast radius small, adds focused regression tests, and resolves all verified data correctness problems without redesigning the chart layer.

### Option C: Broader Score Model Refactor

Create a shared academic score normalization module and migrate all dashboard/report score paths to it. This would be cleaner long term, but it is higher risk because reports, admin dashboards, and academic pages also consume evaluation scores.

## Decision

Use Option B.

The dashboard should treat persisted `Evaluation.scores`, `totalScore`, and `finalScore` as canonical 0-100 values because the current UI and API both accept and store 0-100. The code should not infer "0-10" from a numeric value alone for component scores or final scores, because `10` is a valid low 100-point score.

For inconsistent legacy records where `totalScore <= 10` but component scores are present on a 0-100 scale, prefer the component average. This avoids showing `0.8/10` when the detailed score fields clearly indicate an 80-point evaluation. If a record only has `totalScore=8` and no components, the dashboard cannot distinguish "8/100" from legacy "8/10" safely, so it should preserve the canonical 0-100 interpretation rather than guessing.

## Data Flow

`src/pages/parent/utils.ts` owns score normalization and chart data helpers:

- Normalize persisted scores by clamping to `0..100`, not multiplying `<= 10`.
- Build radar comparison data with `previous: null` when previous skill data is missing.
- Build term trend points from non-overlapping term date ranges.
- Return raw 0-100 averages from `buildTermTrendData`; the hook converts once to 0-10 display scale.

`src/pages/parent/hooks/useParentDashboardState.ts` owns dashboard assembly:

- Use a helper to convert `finalScore` from 0-100 to 0-10.
- Use the utility radar comparison helper instead of rebuilding fallback data inline.

`src/pages/parent/components/LearningProgressCharts.tsx` should accept nullable previous radar values and render missing values as unavailable rather than as the target.

## Testing Strategy

Add focused regression tests before implementation:

- `buildRadarMetrics` keeps `10` as `10%`, not `100%`.
- `buildRadarComparisonData` uses `null` for missing previous skill values.
- `buildTermTrendData` uses tooltip fallback labels consistently.
- `buildTermTrendData` assigns an evaluation to only one adjacent term.
- `buildTermTrendData` preserves raw average precision so hook-level conversion rounds once.
- `getAverageScore100` prefers 100-point component average when `totalScore` looks legacy.
- `getEvaluationFinalScore10` converts `finalScore=10` to `1.0`, not `10.0`.

Verification commands:

- `npm.cmd run test -- src/pages/parent/utils.test.ts src/pages/parent/hooks/useParentDashboardState.test.ts`
- `npm.cmd run typecheck`
