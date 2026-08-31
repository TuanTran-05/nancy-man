import { useEffect, useMemo, useState } from 'react';
import {
  changeAccountRole,
  createAccount,
  getAccounts,
  lockAccount,
  recoverAccount,
  revokeAccount,
  type ApiError,
  type OpsAccountSummary,
  type OpsRole,
  type SessionInfo
} from '../api.js';
import { RevokeUserDialog } from '../components/RevokeUserDialog.js';

const roleLabels: Record<OpsRole, string> = {
  ops_owner: 'Owner',
  ops_maintainer: 'Maintainer',
  ops_readonly: 'Read-only'
};
const statusLabels: Record<OpsAccountSummary['status'], string> = {
  pending_mfa: 'Chờ thiết lập MFA',
  active: 'Đang hoạt động',
  locked: 'Đã khóa',
  revoked: 'Đã thu hồi — trạng thái kết thúc'
};

function errorMessage(error: unknown): string {
  const code = (error as ApiError | undefined)?.code;
  if (code === 'ACCOUNT_USERNAME_CONFIRMATION_REQUIRED') return 'Username xác nhận chưa chính xác.';
  if (code === 'ACCOUNT_FINAL_OWNER_PROTECTED') return 'Không thể thay đổi owner cuối cùng.';
  if (code === 'ACCOUNT_SELF_PROTECTED') return 'Không thể tự thay đổi tài khoản đang đăng nhập.';
  if (code === 'STEP_UP_REQUIRED') return 'Phiên xác nhận nâng quyền đã hết hạn. Hãy xác nhận lại.';
  if (code === 'PERMISSION_DENIED') return 'Bạn không có quyền quản trị tài khoản.';
  return 'Không thể hoàn tất thay đổi tài khoản.';
}

function EnrollmentNotice({
  value,
  expiresAt,
  onDismiss
}: {
  value: string;
  expiresAt: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel enrollment-notice" role="status">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ONE-TIME ENROLLMENT</p>
          <h3>Liên kết thiết lập MFA</h3>
        </div>
        <button type="button" onClick={onDismiss}>
          Ẩn liên kết enrollment
        </button>
      </div>
      <p className="muted">Chỉ hiển thị một lần. Link hết hạn sau 24 giờ ({new Date(expiresAt).toLocaleString('vi-VN')}).</p>
      <input aria-label="Liên kết enrollment" value={value} readOnly autoComplete="off" />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? 'Đã sao chép' : 'Sao chép liên kết'}
      </button>
    </section>
  );
}

export function UsersPage({
  session,
  onUnauthorized
}: {
  session: SessionInfo;
  onUnauthorized: () => void;
}) {
  const [accounts, setAccounts] = useState<OpsAccountSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ url: string; expiresAt: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<OpsAccountSummary | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<OpsRole>('ops_maintainer');
  const [formBusy, setFormBusy] = useState(false);

  const refresh = async () => {
    try {
      const result = await getAccounts();
      setAccounts(result.accounts);
      setLoaded(true);
    } catch (caught) {
      if ((caught as ApiError)?.status === 401) onUnauthorized();
      else setError(errorMessage(caught));
    }
  };
  useEffect(() => {
    if (session.role !== 'ops_owner') {
      setLoaded(true);
      return;
    }
    void refresh();
  }, [session.role]);

  const activeOwners = useMemo(
    () => accounts.filter((account) => account.role === 'ops_owner' && account.status === 'active').length,
    [accounts]
  );
  const csrfToken = session.csrfToken ?? '';
  if (session.role !== 'ops_owner') {
    return (
      <section className="panel placeholder-page" role="alert">
        <h2>Người dùng</h2>
        <p className="muted">Bạn không có quyền quản trị tài khoản.</p>
      </section>
    );
  }

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      if ((caught as ApiError)?.status === 401) onUnauthorized();
      else setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormBusy(true);
    setError(null);
    try {
      const result = await createAccount({ username, email, displayName, role }, csrfToken);
      setEnrollment({ url: result.enrollmentUrl, expiresAt: result.expiresAt });
      setUsername('');
      setEmail('');
      setDisplayName('');
      await refresh();
    } catch (caught) {
      if ((caught as ApiError)?.status === 401) onUnauthorized();
      else setError(errorMessage(caught));
    } finally {
      setFormBusy(false);
    }
  };

  if (!loaded) return <p className="loading-panel">Đang tải danh sách người dùng…</p>;
  return (
    <>
      <section className="panel users-heading">
        <p className="eyebrow">ACCESS / ACCOUNTS</p>
        <h2>Người dùng</h2>
        <p className="muted">Chỉ owner có thể tạo, khóa, khôi phục hoặc thu hồi tài khoản vận hành.</p>
      </section>
      {enrollment ? (
        <EnrollmentNotice
          value={enrollment.url}
          expiresAt={enrollment.expiresAt}
          onDismiss={() => setEnrollment(null)}
        />
      ) : null}
      <section className="panel create-account-panel">
        <div className="panel-heading">
          <h3>Tạo tài khoản vận hành</h3>
          <span className="muted">Link MFA một lần · 24 giờ</span>
        </div>
        <form onSubmit={create}>
          <div className="account-form-grid">
            <label>
              Tên đăng nhập mới
              <input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="off" />
            </label>
            <label>
              Email mới
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" />
            </label>
            <label>
              Tên hiển thị mới
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="off" />
            </label>
            <label>
              Vai trò tài khoản mới
              <select aria-label="Vai trò tài khoản mới" value={role} onChange={(event) => setRole(event.target.value as OpsRole)}>
                <option value="ops_maintainer">Maintainer</option>
                <option value="ops_readonly">Read-only</option>
                <option value="ops_owner">Owner</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={formBusy}>
            {formBusy ? 'Đang tạo…' : 'Tạo liên kết enrollment'}
          </button>
        </form>
      </section>
      {error ? <p className="alert-text" role="alert">{error}</p> : null}
      <section className="accounts-list" aria-label="Danh sách tài khoản">
        {accounts.map((account) => {
          const self = account.id === session.userId;
          const finalOwner = account.role === 'ops_owner' && account.status === 'active' && activeOwners <= 1;
          const protectedRow = self || finalOwner;
          return (
            <article className="panel account-row" key={account.id}>
              <div className="account-row-header">
                <div>
                  <h3>{account.displayName}</h3>
                  <p className="muted">{account.username} · {account.email}</p>
                </div>
                <span className={`level level-${account.status === 'active' ? 'healthy' : account.status === 'revoked' ? 'critical' : 'warning'}`}>
                  {statusLabels[account.status]}
                </span>
              </div>
              <p className="muted">Vai trò: {roleLabels[account.role]} · MFA: {account.mfaEnrolled ? 'đã thiết lập' : 'chưa thiết lập'}</p>
              {self ? <p className="account-protection">Không thể tự khóa hoặc tự thu hồi tài khoản owner đang đăng nhập.</p> : null}
              {finalOwner ? <p className="account-protection">Không thể xóa owner cuối cùng.</p> : null}
              {account.status !== 'revoked' ? (
                <div className="account-actions">
                  <label>
                    Vai trò
                    <select
                      aria-label={`Vai trò của ${account.username}`}
                      value={account.role}
                      disabled={protectedRow || busyId === account.id}
                      onChange={(event) => {
                        const nextRole = event.target.value as OpsRole;
                        void run(account.id, () => changeAccountRole(account.id, nextRole, csrfToken));
                      }}
                    >
                      <option value="ops_maintainer">Maintainer</option>
                      <option value="ops_readonly">Read-only</option>
                      <option value="ops_owner">Owner</option>
                    </select>
                  </label>
                  {account.status === 'locked' ? (
                    <button type="button" disabled={protectedRow || busyId === account.id} onClick={() => void run(account.id, () => recoverAccount(account.id, csrfToken).then((result) => setEnrollment({ url: result.enrollmentUrl, expiresAt: result.expiresAt })))}>
                      Cấp lại liên kết MFA cho {account.username}
                    </button>
                  ) : (
                    <button type="button" disabled={protectedRow || busyId === account.id} onClick={() => void run(account.id, () => lockAccount(account.id, 'OWNER_LOCK', csrfToken))}>
                      Khóa tài khoản {account.username}
                    </button>
                  )}
                  <button type="button" disabled={protectedRow || busyId === account.id} onClick={() => setRevokeTarget(account)}>
                    Thu hồi {account.username}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
      {revokeTarget ? (
        <RevokeUserDialog
          username={revokeTarget.username}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={async () => {
            const target = revokeTarget;
            setRevokeTarget(null);
            await run(target.id, () => revokeAccount(target.id, target.username, csrfToken));
          }}
        />
      ) : null}
    </>
  );
}
