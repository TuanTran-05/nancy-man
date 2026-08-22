# Zalo Rank Notification Design

Date: 2026-06-06
Status: Approved for implementation planning

## Goal

Add a teacher-selected rank field to end-of-course evaluations. Ranked students receive one extra Zalo ZNS template after the evaluation template and before the tuition notice. Unranked students keep the current flow.

## Scope

This feature covers:

- A new `Hạng` field in the evaluation modal with three choices: `Không hạng`, `Hạng Nhất`, and `Hạng Nhì`.
- Persistence of the selected rank on evaluation records.
- A new Zalo rank-achievement notification template.
- Ordered notification sending:
  - Unranked: evaluation, then tuition.
  - Ranked: evaluation, rank achievement, then tuition.
- Office academic bulk sends and individual sends.
- Class detail evaluation sends and resend-from-card behavior.

This feature does not calculate rankings automatically. Teachers choose the rank manually.

## Data Model

Add a rank field to evaluations:

```ts
type EvaluationRank = 'none' | 'first' | 'second';
```

`none` is the default. Existing evaluation records without a rank are treated as `none`.

Backend create and update handlers normalize incoming values. Only `none`, `first`, and `second` are accepted. Invalid or missing values are stored as `none`.

Rank display values:

- `first` -> `HẠNG NHẤT`
- `second` -> `HẠNG NHÌ`
- `none` -> no rank template

Discount display values:

- `first` -> `10%`
- `second` -> `5%`

## UI Design

The evaluation modal adds a compact `Hạng` selector near the evaluation type and score fields. It uses the same segmented-button style as the existing evaluation type selector.

The options are:

- `Không hạng`
- `Hạng Nhất`
- `Hạng Nhì`

Default value for new evaluations is `Không hạng`. Editing an existing evaluation loads its saved rank. The AI feedback action does not change rank.

## Zalo Template

Add a new env-backed template ID:

```txt
ZALO_ZNS_RANK_TEMPLATE_ID
```

The Zalo config helper exposes this field and the status endpoint includes it so admins can verify configuration.

Add a new client service function:

```ts
sendZaloRankNotification(payload)
```

Add a new API action:

```txt
/api/v1/zalo/notify-rank-achievement
```

The backend resolves the canonical student recipient from `studentId` and `classId`. Client-supplied names, phone numbers, and codes are not trusted for delivery.

Template fields:

- `student_name`
- `student_code`
- `rank`
- `discount`

The Zalo message logs use type `rank_achievement`.

## Notification Flow

When sending an evaluation from the class detail flow:

1. Send the evaluation template.
2. If rank is `first` or `second`, send the rank-achievement template.
3. Continue the existing flow after that.

When sending from Office Academic:

1. For `evaluation` mode, send evaluation and optional rank.
2. For `both` mode, send evaluation, optional rank, then tuition.
3. For `tuition` mode, do not send rank.

If the rank template fails, show or record the failure, but still continue to tuition. This matches the product decision that staff can manually resend the rank template later.

## Error Handling

The rank template endpoint returns a normal Zalo notification response with `success`, `messageId`, and `error`.

Missing `ZALO_ZNS_RANK_TEMPLATE_ID` returns a clear configuration error. This error does not block tuition in combined flows.

Deduplication should use student, class, rank, and course context so repeated clicks within the server guard window do not send duplicate rank templates.

## Testing

Add or update tests for:

- Evaluation modal renders the rank selector and updates form state.
- Evaluation create/update persists normalized rank.
- Existing evaluations without rank are treated as `none`.
- Class detail evaluation send calls rank notification only for ranked students.
- Office Academic `both` mode sends evaluation, rank, tuition in order for ranked students.
- Office Academic unranked students keep evaluation, tuition only.
- Rank send failure still allows tuition send.
- Zalo API uses canonical recipient data and sends template fields `rank` and `discount`.
- Zalo status includes the new rank template configuration field.

## Implementation Notes

Prefer small helpers for rank behavior, for example:

```ts
getEvaluationRankLabel(rank)
getEvaluationRankDiscount(rank)
isRankedEvaluation(rank)
```

Keep rank formatting centralized so UI, client services, and tests do not duplicate string mappings.
