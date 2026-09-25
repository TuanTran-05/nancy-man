import { useCallback, useEffect, useState } from 'react';
import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';
import {
  getIssues,
  getIssueDetail,
  updateIssueStatus,
  type InboxIssue,
  type IssueDetail,
  type SessionInfo
} from '../api.js';

export function IssuesPage({
  session,
  onUnauthorized
}: {
  session: SessionInfo;
  onUnauthorized: () => void;
}) {
  const [issues, setIssues] = useState<InboxIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  const loadIssues = useCallback(async () => {
    try {
      const response = await getIssues(100);
      setIssues(response.issues);
    } catch (error) {
      void captureBrowserException(error, {
        code: 'UNHANDLED_BROWSER_EXCEPTION',
        source: 'browser',
        route: () => globalThis.location?.pathname
      });
      if (String(error).includes('401') || String(error).includes('AUTH_DENIED')) {
        onUnauthorized();
      }
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadIssues();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadIssues();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadIssues]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedIssueId(id);
    setDetailLoading(true);
    setActionError(null);
    try {
      const result = await getIssueDetail(id);
      setDetail(result);
    } catch (error) {
      void captureBrowserException(error, {
        code: 'UNHANDLED_BROWSER_EXCEPTION',
        source: 'browser',
        route: () => globalThis.location?.pathname
      });
      setActionError('Không thể tải chi tiết sự cố.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleStatusChange = async (
    status: 'acknowledged' | 'investigating' | 'resolved' | 'ignored'
  ) => {
    if (!selectedIssueId || !session.csrfToken || actionInProgress) return;
    setActionInProgress(true);
    setActionError(null);
    try {
      await updateIssueStatus(selectedIssueId, status, session.csrfToken);
      await loadIssues();
      await loadDetail(selectedIssueId);
    } catch (error) {
      void captureBrowserException(error, {
        code: 'UNHANDLED_BROWSER_EXCEPTION',
        source: 'browser',
        route: () => globalThis.location?.pathname
      });
      setActionError('Cập nhật trạng thái thất bại.');
    } finally {
      setActionInProgress(false);
    }
  };

  const filtered = issues.filter((issue) => {
    if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = issue.title?.toLowerCase().includes(q);
      const matchCode = issue.errorCode?.toLowerCase().includes(q);
      const matchSource = issue.source?.toLowerCase().includes(q);
      const matchId = issue.id?.toLowerCase().includes(q);
      return matchTitle || matchCode || matchSource || matchId;
    }
    return true;
  });

  return (
    <div className="issues-page">
      <div className="variables-heading">
        <div className="status-banner">
          <div>
            <h2>Sự cố & Lỗi hệ thống</h2>
            <p className="muted">
              Toàn bộ lỗi từ API, Web VPS, Browser và Worker được ghi nhận theo thời gian thực.
            </p>
          </div>
          <button type="button" onClick={() => void loadIssues()} disabled={loading}>
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>

        <div className="variables-filters">
          <label>
            <span>Tìm kiếm lỗi:</span>
            <input
              type="search"
              placeholder="Tìm theo tiêu đề, mã lỗi, nguồn, ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
          <label>
            <span>Lọc theo trạng thái:</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="new">Mới (new)</option>
              <option value="investigating">Đang điều tra (investigating)</option>
              <option value="acknowledged">Đã xác nhận (acknowledged)</option>
              <option value="resolved">Đã xử lý (resolved)</option>
              <option value="ignored">Bỏ qua (ignored)</option>
            </select>
          </label>
        </div>
      </div>

      <div className="issues-layout">
        <section className="panel issues-panel">
          <h3>
            Danh sách lỗi ({filtered.length} / {issues.length})
          </h3>
          {loading && !issues.length ? (
            <p className="muted">Đang tải danh sách lỗi…</p>
          ) : !filtered.length ? (
            <div className="variables-empty">
              <p>Không có lỗi nào phù hợp với bộ lọc hiện tại.</p>
            </div>
          ) : (
            <div className="issues-list">
              {filtered.map((issue) => {
                const isSelected = issue.id === selectedIssueId;
                return (
                  <article
                    key={issue.id}
                    className={`issue-card ${isSelected ? 'issue-card-selected' : ''}`}
                    onClick={() => void loadDetail(issue.id)}
                  >
                    <div className="issue-card-header">
                      <div className="issue-badges">
                        <span className={`level level-${issue.severity}`}>{issue.severity}</span>
                        <span className={`status-badge status-${issue.status}`}>
                          {issue.status}
                        </span>
                        <span className="source-badge">{issue.source}</span>
                      </div>
                      <span className="muted issue-time">
                        {new Date(issue.lastSeenAt).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <h4 className="issue-title">
                      {issue.title || issue.errorCode || 'Lỗi không xác định'}
                    </h4>
                    {issue.errorCode ? <p className="issue-code">Mã: {issue.errorCode}</p> : null}
                    <div className="issue-meta muted">
                      <span>
                        Lặp lại: <strong>{issue.occurrenceCount}</strong> lần
                      </span>
                      <span>
                        Người dùng ảnh hưởng: <strong>{issue.affectedUserCount}</strong>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedIssueId ? (
          <aside className="panel issue-detail-panel">
            <div className="issue-detail-header">
              <h3>Chi tiết sự cố</h3>
              <button type="button" onClick={() => setSelectedIssueId(null)}>
                Đóng
              </button>
            </div>

            {actionError ? <p className="error-banner">{actionError}</p> : null}

            {detailLoading || !detail ? (
              <p className="muted">Đang tải chi tiết…</p>
            ) : (
              <div className="issue-detail-content">
                <div className="issue-detail-info">
                  <h4>{detail.issue.title || detail.issue.errorCode}</h4>
                  <p className="issue-id muted">ID: {detail.issue.id}</p>

                  <div className="issue-badges">
                    <span className={`level level-${detail.issue.severity}`}>
                      {detail.issue.severity}
                    </span>
                    <span className={`status-badge status-${detail.issue.status}`}>
                      {detail.issue.status}
                    </span>
                    <span className="source-badge">{detail.issue.source}</span>
                  </div>

                  <div className="issue-stats">
                    <p>
                      <strong>Số lần xảy ra:</strong> {detail.issue.occurrenceCount}
                    </p>
                    <p>
                      <strong>Người dùng ảnh hưởng:</strong> {detail.issue.affectedUserCount}
                    </p>
                    <p>
                      <strong>Lần đầu:</strong>{' '}
                      {new Date(detail.issue.firstSeenAt).toLocaleString('vi-VN')}
                    </p>
                    <p>
                      <strong>Lần cuối:</strong>{' '}
                      {new Date(detail.issue.lastSeenAt).toLocaleString('vi-VN')}
                    </p>
                  </div>
                </div>

                <div className="issue-workflow-actions">
                  <h5>Cập nhật trạng thái:</h5>
                  <div className="workflow-buttons">
                    {detail.issue.status !== 'investigating' ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange('investigating')}
                        disabled={actionInProgress}
                      >
                        Đang điều tra
                      </button>
                    ) : null}
                    {detail.issue.status !== 'acknowledged' ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange('acknowledged')}
                        disabled={actionInProgress}
                      >
                        Đã xác nhận
                      </button>
                    ) : null}
                    {detail.issue.status !== 'resolved' ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange('resolved')}
                        disabled={actionInProgress}
                      >
                        Đã giải quyết
                      </button>
                    ) : null}
                    {detail.issue.status !== 'ignored' ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange('ignored')}
                        disabled={actionInProgress}
                      >
                        Bỏ qua
                      </button>
                    ) : null}
                  </div>
                </div>

                {detail.events.length > 0 ? (
                  <div className="issue-latest-event">
                    <h5>Lần xảy ra gần nhất:</h5>
                    {(() => {
                      const latest = detail.events[0];
                      return (
                        <div className="event-box">
                          {latest.route ? (
                            <p>
                              <strong>Route:</strong>{' '}
                              <code>
                                {latest.method ? `${latest.method} ` : ''}
                                {latest.route}
                              </code>
                            </p>
                          ) : null}
                          {latest.httpStatus ? (
                            <p>
                              <strong>HTTP Status:</strong> <code>{latest.httpStatus}</code>
                            </p>
                          ) : null}
                          {latest.requestId ? (
                            <p>
                              <strong>Request ID:</strong> <code>{latest.requestId}</code>
                            </p>
                          ) : null}
                          {latest.safeMessage ? (
                            <p>
                              <strong>Thông báo lỗi:</strong> {latest.safeMessage}
                            </p>
                          ) : null}
                          {latest.stackTrace ? (
                            <div className="stack-trace-box">
                              <strong>Stack Trace:</strong>
                              <pre>{latest.stackTrace}</pre>
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
