export function ApplyProgress({ state, reason }: { state: string; reason?: string }) {
  return <section className="panel apply-progress" aria-live="polite"><p className="eyebrow">APPLY PROGRESS</p><h3>{state}</h3>{reason ? <p className="muted">{reason}</p> : null}</section>;
}
