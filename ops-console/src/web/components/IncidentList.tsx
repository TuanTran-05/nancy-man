import type { Incident } from '../../shared/models.js';

export function IncidentList({ incidents, onAcknowledge }: { incidents: Incident[]; onAcknowledge: (incident: Incident) => void }) {
  if (!incidents.length) return <section className="panel"><h2>Sự cố</h2><p className="muted">Không có sự cố đang mở.</p></section>;
  return <section className="panel"><h2>Sự cố</h2><div className="incident-list">{incidents.map((incident) => <article className="incident-row" key={incident.id}><div><span className={`level level-${incident.level}`}>{incident.level}</span><h3>{incident.safeSummary}</h3><p className="muted">Lần cuối: {new Date(incident.lastSeenAt).toLocaleString('vi-VN')} · Số lần: {incident.occurrenceCount}</p></div>{incident.state === 'open' ? <button type="button" onClick={() => onAcknowledge(incident)}>Xác nhận đã xem</button> : <span className="muted">Đã acknowledge</span>}</article>)}</div></section>;
}
