import { useState } from 'react';
import { createZaloLinkCode, disableZaloLink, type ZaloLinkInfo } from '../api.js';

export function ZaloLinkPanel({ info, csrfToken, onChanged }: { info: ZaloLinkInfo; csrfToken: string; onChanged: () => Promise<void> }) {
  const [code, setCode] = useState<{ command: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true); setError(null);
    try { const next = await createZaloLinkCode(csrfToken); setCode(next); } catch { setError('Không tạo được mã liên kết.'); } finally { setBusy(false); }
  };
  const unlink = async () => {
    setBusy(true); setError(null);
    try { await disableZaloLink(csrfToken); setCode(null); await onChanged(); } catch { setError('Không thể hủy liên kết.'); } finally { setBusy(false); }
  };
  return <section className="panel zalo-link-panel"><div className="panel-heading"><div><p className="eyebrow">OPS ALERT CHANNEL</p><h2>Bot Zalo của man</h2></div><span className={info.linked ? 'level level-healthy' : 'level level-unknown'}>{info.linked ? 'Đã liên kết' : 'Chưa liên kết'}</span></div><p className="muted">Bot này độc lập với bot của web nội bộ. Mã chỉ dùng một lần và hết hạn sau vài phút.</p>{info.linked ? <div className="link-status"><p>Bot sẽ gửi cảnh báo vào cuộc trò chuyện Zalo đã liên kết.</p>{info.lastSeenAt ? <p className="muted">Tin nhắn cuối: {new Date(info.lastSeenAt).toLocaleString('vi-VN')}</p> : null}<button type="button" onClick={unlink} disabled={busy}>Hủy liên kết</button></div> : <button type="button" onClick={generate} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo mã liên kết Zalo'}</button>}{code ? <div className="link-code" role="status"><strong>{code.command}</strong><span>Gửi lệnh này cho bot trước {new Date(code.expiresAt).toLocaleTimeString('vi-VN')}.</span></div> : null}{error ? <p role="alert" className="alert-text">{error}</p> : null}</section>;
}
