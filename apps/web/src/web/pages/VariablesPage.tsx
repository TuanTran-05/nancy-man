import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getVariableCatalog,
  getVariableInventory,
  lockVariables,
  unlockVariables,
  type ApiError,
  type SessionInfo,
  type VariableCategory,
  type VariableInventoryItem
} from '../api.js';
import { VariableRow } from '../components/VariableRow.js';
import { VariablesUnlock } from '../components/VariablesUnlock.js';

const categoryLabels: Record<VariableCategory, string> = {
  database: 'Database',
  auth_security: 'Auth / security',
  payments: 'Payments',
  storage: 'Storage',
  integrations: 'Integrations',
  telemetry: 'Telemetry',
  backup_jobs: 'Backup / jobs',
  feature_flags: 'Feature flags',
  email_notifications: 'Email notifications',
  runtime_networking: 'Runtime / networking',
  build_public_frontend: 'Build / public frontend'
};

function errorMessage(error: unknown): string {
  const apiError = error as ApiError | undefined;
  if (apiError?.code === 'MFA_DENIED') return 'Mật khẩu hoặc mã TOTP không hợp lệ.';
  if (apiError?.code === 'RATE_LIMITED') return 'Quá nhiều lần thử. Hãy chờ trước khi thử lại.';
  if (apiError?.code === 'STEP_UP_REQUIRED') return 'Quyền mở khóa đã hết hạn. Hãy xác nhận lại.';
  if (apiError?.code === 'CONFIG_AGENT_UNAVAILABLE') return 'Config Agent hiện không khả dụng.';
  if (apiError?.code === 'CONFIG_AGENT_PROTOCOL_ERROR')
    return 'Config Agent trả về giao thức không hợp lệ.';
  if (apiError?.status === 401) return 'Phiên vận hành đã hết hạn. Hãy đăng nhập lại.';
  return 'Không thể tải inventory variables.';
}

function isSessionUnauthorized(error: unknown): boolean {
  const apiError = error as ApiError | undefined;
  return (
    apiError?.status === 401 &&
    apiError.code !== 'MFA_DENIED' &&
    apiError.code !== 'STEP_UP_REQUIRED'
  );
}

function searchableText(item: VariableInventoryItem): string {
  return [
    item.name,
    item.appName,
    item.appId,
    item.description,
    item.sourceId,
    item.sourcePathLabel,
    item.consumerIds.join(' '),
    item.functionIds.join(' '),
    item.category
  ]
    .join(' ')
    .toLocaleLowerCase('vi-VN');
}

export function VariablesPage({
  session,
  onUnauthorized
}: {
  session: SessionInfo;
  onUnauthorized: () => void;
}) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof getVariableCatalog>> | null>(
    null
  );
  const [items, setItems] = useState<VariableInventoryItem[]>([]);
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [search, setSearch] = useState('');
  const [appFilter, setAppFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | VariableCategory>('all');
  const itemsRef = useRef<VariableInventoryItem[]>([]);
  const catalogRef = useRef<typeof catalog>(null);

  const clearValues = useCallback(() => {
    itemsRef.current = [];
    catalogRef.current = null;
    setItems([]);
    setCatalog(null);
    setUnlockedUntil(null);
    setLoadingInventory(false);
    setSearch('');
    setAppFilter('all');
    setCategoryFilter('all');
  }, []);

  useEffect(() => {
    if (unlockedUntil === null) return;
    const maximumTimerDelay = 2_147_483_647;
    let timer: number | undefined;
    const scheduleExpiry = () => {
      const remaining = unlockedUntil - Date.now();
      if (remaining <= 0) {
        clearValues();
        return;
      }
      timer = window.setTimeout(scheduleExpiry, Math.min(remaining, maximumTimerDelay));
    };
    scheduleExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [clearValues, unlockedUntil]);

  useEffect(() => {
    return () => {
      itemsRef.current = [];
      catalogRef.current = null;
    };
  }, []);

  const reportUnauthorized = useCallback(() => {
    clearValues();
    onUnauthorized();
  }, [clearValues, onUnauthorized]);

  const readInventory = useCallback(
    async (clearError: boolean) => {
      if (clearError) setError(null);
      setItems([]);
      setCatalog(null);
      itemsRef.current = [];
      catalogRef.current = null;
      setLoadingInventory(true);
      try {
        const [nextCatalog, nextInventory] = await Promise.all([
          getVariableCatalog(),
          getVariableInventory()
        ]);
        itemsRef.current = nextInventory.items;
        catalogRef.current = nextCatalog;
        setCatalog(nextCatalog);
        setItems(nextInventory.items);
      } catch (caught) {
        clearValues();
        setError(errorMessage(caught));
        if (isSessionUnauthorized(caught)) reportUnauthorized();
      } finally {
        setLoadingInventory(false);
      }
    },
    [clearValues, reportUnauthorized]
  );

  const unlock = useCallback(
    async (input: { password: string; totpCode: string }) => {
      setError(null);
      clearValues();
      try {
        const result = await unlockVariables(input, session.csrfToken ?? '');
        const deadline = Date.parse(result.unlockedUntil);
        if (!Number.isFinite(deadline)) throw new Error('INVALID_UNLOCK_DEADLINE');
        if (deadline <= Date.now()) {
          const expired = new Error('STEP_UP_REQUIRED') as ApiError;
          expired.code = 'STEP_UP_REQUIRED';
          throw expired;
        }
        setUnlockedUntil(deadline);
        await readInventory(false);
      } catch (caught) {
        clearValues();
        setError(errorMessage(caught));
        if (isSessionUnauthorized(caught)) reportUnauthorized();
      }
    },
    [clearValues, readInventory, reportUnauthorized, session.csrfToken]
  );

  const lock = useCallback(async () => {
    clearValues();
    try {
      await lockVariables(session.csrfToken ?? '');
    } catch (caught) {
      setError(errorMessage(caught));
      if (isSessionUnauthorized(caught)) reportUnauthorized();
    }
  }, [clearValues, reportUnauthorized, session.csrfToken]);

  const apps = useMemo(() => {
    const known = catalog?.apps ?? [];
    const knownIds = new Set(known.map((app) => app.id));
    const observed = items
      .filter((item) => !knownIds.has(item.appId))
      .map((item) => ({ id: item.appId, displayName: item.appName, runtimeVariableCount: 0 }));
    return [
      ...known,
      ...observed.filter(
        (app, index) => observed.findIndex((other) => other.id === app.id) === index
      )
    ];
  }, [catalog?.apps, items]);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items]
  );

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
    return items.filter((item) => {
      if (appFilter !== 'all' && item.appId !== appFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      return !normalizedSearch || searchableText(item).includes(normalizedSearch);
    });
  }, [appFilter, categoryFilter, items, search]);

  const visibleByApp = useMemo(
    () =>
      new Map(apps.map((app) => [app.id, visibleItems.filter((item) => item.appId === app.id)])),
    [apps, visibleItems]
  );

  if (unlockedUntil === null) {
    return <VariablesUnlock onUnlock={unlock} error={error} />;
  }

  return (
    <>
      <section className="panel variables-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ACCESS / VARIABLES</p>
            <h2>Variables read-only</h2>
            <p className="muted">
              Giá trị hiển thị đầy đủ trong thời gian xác nhận, hết hạn lúc{' '}
              {new Date(unlockedUntil).toLocaleString('vi-VN')}.
            </p>
          </div>
          <div className="variables-actions">
            <button
              type="button"
              onClick={() => void readInventory(true)}
              disabled={loadingInventory}
            >
              {loadingInventory ? 'Đang tải…' : 'Làm mới'}
            </button>
            <button type="button" onClick={() => void lock()}>
              Khóa giá trị
            </button>
          </div>
        </div>
      </section>
      <section className="panel variables-filters" aria-label="Bộ lọc variables">
        <label>
          Tìm variables
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tên, source, consumer…"
            autoComplete="off"
          />
        </label>
        <label>
          Ứng dụng
          <select value={appFilter} onChange={(event) => setAppFilter(event.target.value)}>
            <option value="all">Tất cả ứng dụng</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Danh mục
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as 'all' | VariableCategory)}
          >
            <option value="all">Tất cả danh mục</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error ? (
        <p className="alert-text" role="alert">
          {error}
        </p>
      ) : null}
      {loadingInventory && items.length === 0 ? (
        <p className="loading-panel">Đang tải inventory variables…</p>
      ) : null}
      <section className="variables-app-list" aria-label="Inventory variables theo ứng dụng">
        {apps.map((app) => {
          const appItems = visibleByApp.get(app.id) ?? [];
          const hasInventory = items.some((item) => item.appId === app.id);
          return (
            <section className="variables-app" key={app.id}>
              <div className="variables-app-heading">
                <div>
                  <p className="eyebrow">APP</p>
                  <h3>{app.displayName}</h3>
                </div>
                <span className="muted">
                  {appItems.length} hiển thị · catalog {app.runtimeVariableCount}
                </span>
              </div>
              {appItems.length ? (
                <div className="variables-list">
                  {appItems.map((item, index) => (
                    <VariableRow
                      key={`${item.sourceId}:${item.name}:${item.catalogId ?? 'unknown'}:${index}`}
                      item={item}
                    />
                  ))}
                </div>
              ) : (
                <p className="variables-empty">
                  {hasInventory
                    ? 'Không có variables phù hợp bộ lọc.'
                    : 'Không có variables runtime'}
                </p>
              )}
            </section>
          );
        })}
      </section>
      <p className="footer-note">
        Variables workspace chỉ đọc; không có thao tác sửa, xóa hoặc áp dụng.
      </p>
    </>
  );
}
