import { useState } from 'react';
import type { Incident } from '../../shared/models.js';

export function AcknowledgeDialog({ incident, onClose, onSubmit }: { incident: Incident; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (!note.trim()) return; setBusy(true); try { await onSubmit(note); } finally { setBusy(false); } };
  return <div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ack-title"><h2 id="ack-title">Xác nhận đã xem</h2><p>{incident.safeSummary}</p><label>Ghi chú<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="dialog-actions"><button type="button" onClick={onClose}>Hủy</button><button type="button" onClick={submit} disabled={busy || !note.trim()}>{busy ? 'Đang lưu…' : 'Lưu acknowledge'}</button></div></div></div>;
}
