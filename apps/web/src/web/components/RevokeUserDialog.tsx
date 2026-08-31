import { useState } from 'react';

export function RevokeUserDialog({
  username,
  onCancel,
  onConfirm
}: {
  username: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const exact = confirmation === username;
  return (
    <div className="dialog-backdrop">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
        <h2 id="revoke-title">Thu hồi vĩnh viễn tài khoản</h2>
        <p className="muted">
          Tài khoản <strong>{username}</strong> sẽ mất toàn bộ phiên, MFA và quyền truy cập. Hành
          động này không thể hoàn tác.
        </p>
        <label>
          Nhập lại username để thu hồi
          <input
            aria-label="Nhập lại username để thu hồi"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button
            type="button"
            disabled={!exact || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Đang thu hồi…' : 'Thu hồi vĩnh viễn'}
          </button>
        </div>
      </section>
    </div>
  );
}
