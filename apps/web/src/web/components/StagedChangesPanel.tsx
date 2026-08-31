import type { ChangeImpactPlan } from '../api.js';

export type StagedChange = {
  changeId: string;
  appId: string;
  reason: string;
  state: string;
  changeDigest?: string;
  impactPlan?: ChangeImpactPlan;
};

export function StagedChangesPanel({
  change,
  onValidate,
  onApply
}: {
  change: StagedChange | null;
  onValidate: () => void;
  onApply: () => void;
}) {
  if (!change) return null;
  return (
    <section className="panel staged-changes" aria-label="Bản nháp variables">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">STAGED CHANGE</p>
          <h3>{change.changeId}</h3>
        </div>
        <span className="badge">{change.state}</span>
      </div>
      <p className="muted">
        Ứng dụng: {change.appId} · Lý do: {change.reason}
      </p>
      {change.impactPlan ? (
        <div className="muted">
          <p>
            {change.impactPlan.counts.items} mục · {change.impactPlan.sourceIds.length} source ·{' '}
            {change.impactPlan.strategies.join(', ')}
          </p>
          <p>
            Actions:{' '}
            {change.impactPlan.actionIds.length
              ? change.impactPlan.actionIds.join(', ')
              : 'Không có'}
          </p>
          <p>
            Health checks:{' '}
            {change.impactPlan.checkIds.length ? change.impactPlan.checkIds.join(', ') : 'Không có'}
          </p>
        </div>
      ) : null}
      <div className="variables-actions">
        <button type="button" onClick={onValidate} disabled={change.state !== 'DRAFT'}>
          Kiểm tra
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={change.state !== 'SAVED' || !change.changeDigest}
        >
          Áp dụng
        </button>
      </div>
    </section>
  );
}
