# Beszel Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm section “Hạ tầng VPS” responsive vào Ops Console, hiển thị current metrics, nullable history chart, systemd services và telemetry stale state mà không lộ hay liên kết trực tiếp đến Beszel Hub.

**Architecture:** Browser tiếp tục gọi duy nhất API của Ops Console. `InfrastructureSection` sở hữu range state và gọi endpoint history đã xác thực; các formatter/helper chart là pure functions; SVG nội bộ tạo các segment riêng để metric `null` hiển thị gap thay vì zero.

**Tech Stack:** React 19, TypeScript 5.8, CSS, inline SVG, Testing Library, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-beszel-telemetry-integration-design.md`

## Global Constraints

- Kế hoạch backend `2026-08-24-beszel-backend-integration.md` phải hoàn tất trước kế hoạch này.
- Không thêm chart library, CDN, iframe, CSP exception hoặc browser call đến port `8090`/PocketBase.
- Section nằm ngay sau `OverviewCards`; login/TOTP, Zalo link, monitor và incident flow giữ nguyên.
- Range chính xác `1h|24h|7d|30d`, mặc định `24h`.
- Sample `host_resources` quá 150 giây hoặc monitor `beszel` không healthy phải hiển “Telemetry hạ tầng không khả dụng”.
- Metric thiếu hiển “Không khả dụng”; không đổi `null` thành `0` trong card, tooltip, chart hoặc formatter.
- Service failed đứng trước; mỗi item chỉ dùng safe projection sáu field từ backend.
- SVG có accessible name; range controls dùng semantic buttons với `aria-pressed`.
- Layout dùng được ở viewport rộng 360px và không có control restart/config/terminal/SQL.
- Thực thi trong cùng isolated worktree/branch đã hoàn tất backend plan.

---

## File map

- `ops-console/src/web/infrastructure.ts`: pure formatter, stale decision và chart-segment geometry.
- `ops-console/src/web/components/InfrastructureChart.tsx`: accessible inline SVG, legend và empty state.
- `ops-console/src/web/components/InfrastructureSection.tsx`: cards, range state, fetch lifecycle, service list.
- `ops-console/src/web/api.ts`: typed history request.
- `ops-console/src/web/App.tsx`: mount section after overview.
- `ops-console/src/web/styles.css`: cards/chart/service responsive styles.
- `ops-console/e2e/fixture-server.mjs`: deterministic infrastructure samples.
- `ops-console/e2e/ops-console.spec.ts`: authenticated operator flow and absence of destructive/direct-Beszel controls.

### Task 1: Add typed API call and pure display helpers

**Files:**
- Modify: `ops-console/src/web/api.ts`
- Create: `ops-console/src/web/infrastructure.ts`
- Create: `ops-console/src/web/infrastructure.test.ts`

**Interfaces:**
- Consumes: `InfrastructureHistoryRange`, `InfrastructureHistoryResponse`, `DashboardOverview` from shared models.
- Produces: `getInfrastructureHistory(range)`, `isInfrastructureUnavailable`, formatters and `makeLineSegments`.

- [ ] **Step 1: Write failing API URL and range tests**

Mock `fetch`, call each range and assert only same-origin Ops paths:

```ts
await getInfrastructureHistory('24h');
expect(fetch).toHaveBeenCalledWith('/api/infrastructure/history?range=24h', expect.objectContaining({ credentials: 'same-origin' }));
expect(String((fetch as Mock).mock.calls[0][0])).not.toMatch(/8090|pocketbase|beszel/i);
```

The TypeScript range union prevents arbitrary strings; do not add a string overload.

- [ ] **Step 2: Write failing helper tests**

Cover exact behavior:

```ts
expect(formatPercent(null)).toBe('Không khả dụng');
expect(formatPercent(42.56)).toBe('42,6%');
expect(formatBytes(4 * 1024 ** 3)).toBe('4,00 GiB');
expect(formatRate(1536)).toBe('1,50 KiB/s');
expect(isInfrastructureUnavailable(overview, Date.parse('2026-08-24T00:03:16Z'))).toBe(true);
```

For chart points `[10, null, 30, 40]`, expect two segments (`[10]` and `[30,40]`) so the null gap is not connected. Empty/all-null data returns an empty array.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `cd ops-console && npm test -- src/web/infrastructure.test.ts`

Expected: FAIL because helpers do not exist.

- [ ] **Step 4: Implement same-origin API and pure functions**

```ts
export const getInfrastructureHistory = (range: InfrastructureHistoryRange) =>
  request<InfrastructureHistoryResponse>(`/api/infrastructure/history?range=${range}`);

export function isInfrastructureUnavailable(overview: DashboardOverview, now = Date.now()): boolean {
  const beszel = overview.latestByMonitor.beszel;
  const resources = overview.latestByMonitor.host_resources;
  return !beszel || beszel.level !== 'healthy' || !resources ||
    !Number.isFinite(Date.parse(resources.observedAt)) || now - Date.parse(resources.observedAt) > 150_000;
}
```

Format with `Intl.NumberFormat('vi-VN')`. `formatBytes` uses IEC units and returns `Không khả dụng` for null/non-finite/negative. `formatRate` appends `/s`. `makeLineSegments(points,key,width,height)` ignores null values, uses chronological index for x, scales non-null min/max for y, and uses vertical midpoint if min equals max.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd ops-console && npm test -- src/web/infrastructure.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit helpers**

```bash
git add ops-console/src/web/api.ts ops-console/src/web/infrastructure.ts ops-console/src/web/infrastructure.test.ts
git commit -m "feat(ops): add infrastructure display helpers"
```

### Task 2: Build the accessible compact chart

**Files:**
- Create: `ops-console/src/web/components/InfrastructureChart.tsx`
- Create: `ops-console/src/web/components/InfrastructureChart.test.tsx`

**Interfaces:**
- Consumes: `InfrastructureHistoryResponse` and `makeLineSegments`.
- Produces: `InfrastructureChart({ history, metric, label, color, formatter })`.

```ts
export type ChartMetric =
  | 'cpuPercent'
  | 'memoryPercent'
  | 'diskPercent'
  | 'load1'
  | 'networkReceiveBytesPerSecond'
  | 'networkTransmitBytesPerSecond'
  | 'diskReadBytesPerSecond'
  | 'diskWriteBytesPerSecond';
```

- [ ] **Step 1: Write failing rendering and accessibility tests**

```tsx
render(<InfrastructureChart history={history} metric="cpuPercent" label="CPU" color="#67e8f9" formatter={formatPercent} />);
expect(screen.getByRole('img', { name: /CPU trong 24 giờ/i })).toBeInTheDocument();
expect(screen.getAllByTestId('chart-segment')).toHaveLength(2);
expect(screen.getByText('42,5%')).toBeInTheDocument();
```

For all-null history, expect `Không có dữ liệu trong khoảng đã chọn` and no `<polyline>`. Ensure SVG never contains `NaN`, `Infinity` or string `null`.

- [ ] **Step 2: Run chart tests and confirm RED**

Run: `cd ops-console && npm test -- src/web/components/InfrastructureChart.test.tsx`

Expected: FAIL because component is absent.

- [ ] **Step 3: Implement chart with a fixed viewBox**

Use `viewBox="0 0 600 160"`, grid lines and one polyline per segment:

```tsx
<svg className="infra-chart-svg" viewBox="0 0 600 160" role="img" aria-label={`${label} trong ${rangeLabel[history.range]}`}>
  <title>{`${label} trong ${rangeLabel[history.range]}`}</title>
  {segments.map((segment, index) => (
    <polyline key={index} data-testid="chart-segment" points={segment.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />
  ))}
</svg>
```

Show formatted latest non-null value and the history collection timestamp. Do not add raw `<title>` tooltip per point because it becomes unusable on touch; value cards carry the current value.

- [ ] **Step 4: Run component tests and typecheck**

Run: `cd ops-console && npm test -- src/web/components/InfrastructureChart.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit chart**

```bash
git add ops-console/src/web/components/InfrastructureChart.tsx ops-console/src/web/components/InfrastructureChart.test.tsx
git commit -m "feat(ops): render accessible infrastructure charts"
```

### Task 3: Build current cards, range switching and service list

**Files:**
- Create: `ops-console/src/web/components/InfrastructureSection.tsx`
- Create: `ops-console/src/web/components/InfrastructureSection.test.tsx`

**Interfaces:**
- Consumes: `overview: DashboardOverview`, optional `now`, optional `loadHistory` for deterministic tests.
- Produces: a self-contained section with default range `24h`.

- [ ] **Step 1: Write failing healthy-state tests**

Render a fresh overview and fake history loader. Assert heading, four cards, four range buttons, four compact charts (CPU, RAM, network, disk I/O), and sorted services:

```ts
expect(screen.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
expect(loadHistory).toHaveBeenCalledWith('24h');
expect(screen.getAllByRole('article')).toEqual(expect.any(Array));
expect(screen.getAllByTestId('service-row').map((node) => node.textContent)).toEqual([
  expect.stringContaining('postgresql'),
  expect.stringContaining('nginx'),
]);
```

Click `7d`; expect `aria-pressed` to move and exactly one new call with `7d`.

- [ ] **Step 2: Write failing stale/null/error tests**

At 151 seconds old, expect banner `Telemetry hạ tầng không khả dụng` and current card values hidden/replaced with `Không khả dụng`, while last successful charts may remain with a visible `Dữ liệu lịch sử` label. At exactly 150 seconds, current data remains available.

When history fetch fails, show `Không tải được lịch sử hạ tầng.` without removing current safe cards. Missing resource keys render `Không khả dụng`, never `0%` or `0 B/s`.

- [ ] **Step 3: Run section tests and confirm RED**

Run: `cd ops-console && npm test -- src/web/components/InfrastructureSection.test.tsx`

Expected: FAIL because section is absent.

- [ ] **Step 4: Implement current metric cards**

Use `isInfrastructureUnavailable`. Four cards show:

- CPU: `cpuPercent`, secondary `load1 / load5`.
- RAM: used/total and `memoryPercent`, secondary swap used/total.
- Disk: used/total and `diskPercent`, secondary read/write rate plus I/O utilization.
- Network: receive and transmit rate.

Every accessor must use `typeof value === 'number' ? value : null`; never `Number(value ?? 0)`.

- [ ] **Step 5: Implement range/history lifecycle without stale response races**

```ts
useEffect(() => {
  let active = true;
  setHistoryState({ kind: 'loading' });
  loadHistory(range).then(
    (value) => { if (active) setHistoryState({ kind: 'ready', value }); },
    () => { if (active) setHistoryState({ kind: 'error' }); },
  );
  return () => { active = false; };
}, [range, loadHistory]);
```

Render chart pairs from the ready response. Disable only the selected range during its own loading state; current metrics remain visible.

- [ ] **Step 6: Implement safe service table/list**

Read only `host_services.details.services` if it is an array. Revalidate each display item defensively, sort `failed` first then `name.localeCompare('vi')`, and show state/sub-state badge, CPU and memory. Do not display missing service metrics as zero.

- [ ] **Step 7: Run section tests and typecheck**

Run: `cd ops-console && npm test -- src/web/components/InfrastructureSection.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit section**

```bash
git add ops-console/src/web/components/InfrastructureSection.tsx ops-console/src/web/components/InfrastructureSection.test.tsx
git commit -m "feat(ops): add VPS infrastructure section"
```

### Task 4: Mount and style the section responsively

**Files:**
- Modify: `ops-console/src/web/App.tsx`
- Modify: `ops-console/src/web/App.test.tsx`
- Modify: `ops-console/src/web/components/MonitorPanel.tsx`
- Modify: `ops-console/src/web/styles.css`

**Interfaces:**
- Adds infrastructure section immediately after `<OverviewCards />`.
- Adds Vietnamese labels for `beszel`, `host_resources`, `host_services` to `MonitorPanel` and app monitor order.

- [ ] **Step 1: Write failing app placement and control tests**

Mock an authenticated session, overview/history and render `App`. Assert DOM order:

```ts
const overview = screen.getByText('Sự cố đang mở').closest('section');
const infrastructure = screen.getByRole('heading', { name: 'Hạ tầng VPS' }).closest('section');
const monitors = screen.getByRole('heading', { name: 'Monitor' }).closest('section');
expect(overview?.compareDocumentPosition(infrastructure!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(infrastructure?.compareDocumentPosition(monitors!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(screen.queryByText(/Beszel Hub|PocketBase|Restart|Terminal|Chạy SQL/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run App test and confirm RED**

Run: `cd ops-console && npm test -- src/web/App.test.tsx`

Expected: FAIL because section is not mounted.

- [ ] **Step 3: Mount section and extend monitor labels**

Add `InfrastructureSection` after overview. Extend order and labels exactly:

```ts
const monitorOrder = [
  'app_liveness', 'app_health', 'app_process', 'postgres', 'cron', 'backup',
  'errors', 'collector', 'beszel', 'host_resources', 'host_services',
] as const;
```

Labels: `Beszel telemetry`, `Tài nguyên VPS`, `Systemd services`.

- [ ] **Step 4: Add responsive CSS**

Create scoped classes `.infrastructure-section`, `.infra-card-grid`, `.infra-chart-grid`, `.infra-range`, `.infra-service-list`, `.infra-service-row`, `.infra-unavailable`. Desktop uses four cards and two charts per row; below 880px use two cards/one chart; below 600px use one column. Buttons must wrap and remain at least 44px high. SVG uses `width:100%; height:auto; min-height:160px`.

Do not change global login/dialog styles except shared responsive behavior already present.

- [ ] **Step 5: Run all UI unit tests and typecheck**

Run: `cd ops-console && npm test -- src/web && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit integration and styles**

```bash
git add ops-console/src/web/App.tsx ops-console/src/web/App.test.tsx ops-console/src/web/components/MonitorPanel.tsx ops-console/src/web/styles.css
git commit -m "feat(ops): mount responsive infrastructure dashboard"
```

### Task 5: Extend browser E2E and complete the UI gate

**Files:**
- Modify: `ops-console/e2e/fixture-server.mjs`
- Modify: `ops-console/e2e/ops-console.spec.ts`

**Interfaces:**
- Produces: deterministic authenticated E2E coverage using the real built Ops server/store/routes.

- [ ] **Step 1: Seed safe infrastructure fixture rows**

After the existing sample, insert:

```js
const observedAt = new Date().toISOString();
db.prepare(insertSample).run('beszel', 'healthy', observedAt, 5, JSON.stringify({ probeOk: true, hubVersion: '0.18.8', agentVersion: '0.18.8', systemStatus: 'up', metricObservedAt: observedAt }), null);
db.prepare(insertSample).run('host_resources', 'healthy', observedAt, 5, JSON.stringify({ cpuPercent: 42.5, memoryPercent: 50, memoryUsedBytes: 4294967296, memoryTotalBytes: 8589934592, swapPercent: 25, swapUsedBytes: 536870912, swapTotalBytes: 2147483648, load1: 1.2, load5: 0.8, load15: 0.4, cpuThreads: 4, uptimeSeconds: 86400, diskPercent: 50, diskUsedBytes: 25769803776, diskTotalBytes: 51539607552, diskReadBytesPerSecond: 1048576, diskWriteBytesPerSecond: 2097152, diskIoUtilizationPercent: 3, networkReceiveBytesPerSecond: 8192, networkTransmitBytesPerSecond: 4096, agentVersion: '0.18.8', metricObservedAt: observedAt, probeOk: true }), null);
db.prepare(insertSample).run('host_services', 'critical', observedAt, 5, JSON.stringify({ matchedTotal: 2, failedServices: ['postgresql'], services: [{ name: 'postgresql', state: 'failed', subState: 'failed', cpuPercent: 2.1, memoryBytes: 134217728, observedAt }, { name: 'nginx', state: 'active', subState: 'running', cpuPercent: 0.3, memoryBytes: 33554432, observedAt }] }), 'service_failed');
```

Reuse one prepared insert statement; do not put secrets, hostname or IP in rows.

- [ ] **Step 2: Extend E2E assertions**

After login:

```ts
await expect(page.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeVisible();
await expect(page.getByText('42,5%').first()).toBeVisible();
await expect(page.getByText('postgresql')).toBeVisible();
await page.getByRole('button', { name: '7d' }).click();
await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
await expect(page.getByText(/Beszel Hub|PocketBase|Restart|Terminal|Chạy SQL/i)).toHaveCount(0);
```

Add a second test with `page.setViewportSize({ width: 360, height: 800 })`; log in, expand the section and assert every range button plus service row is visible and `document.documentElement.scrollWidth <= window.innerWidth`.

- [ ] **Step 3: Run build and E2E**

Run: `cd ops-console && npm run build && npm run test:e2e -- e2e/ops-console.spec.ts`

Expected: PASS.

- [ ] **Step 4: Run the complete application gate**

Run:

```bash
cd ops-console
npm test
npm run typecheck
npm run build
npm run test:e2e -- e2e/ops-console.spec.ts
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add ops-console/e2e/fixture-server.mjs ops-console/e2e/ops-console.spec.ts
git diff --cached --check
git commit -m "test(ops): cover infrastructure dashboard flow"
```

---

## Dashboard completion signal

The plan is complete when a logged-in operator sees fresh current metrics and nullable history, stale data is visibly unavailable, failed services sort first, range changes are accessible, the 360px layout is usable, and no UI/control/network path exposes Beszel Hub. Do not enable production yet; continue with `2026-08-24-beszel-host-rollout.md`.
