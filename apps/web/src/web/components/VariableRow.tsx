import type { VariableInventoryItem } from '../api.js';

const categoryLabels: Record<VariableInventoryItem['category'], string> = {
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

const applyStrategyLabels: Record<VariableInventoryItem['applyStrategy'], string> = {
  no_runtime_action: 'Không cần tác động runtime',
  next_job: 'Job kế tiếp',
  runtime_restart: 'Khởi động lại runtime',
  credential_restart: 'Khởi động lại credential consumer',
  build_redeploy: 'Build và redeploy'
};

const sensitivityLabels: Record<VariableInventoryItem['sensitivity'], string> = {
  public: 'Public',
  internal: 'Internal',
  secret: 'Secret'
};

const requirementLabels: Record<VariableInventoryItem['requirement'], string> = {
  required: 'Bắt buộc',
  optional: 'Tùy chọn',
  unknown: 'Unknown'
};

const adapterLabels: Record<VariableInventoryItem['sourceAdapter'], string> = {
  node_env_file: 'Node env file',
  systemd_environment_file: 'Systemd environment file',
  systemd_credential_file: 'Systemd credential file',
  dotenv: 'Dotenv',
  pm2_ecosystem_static: 'PM2 ecosystem (observed)',
  none: 'Không có source'
};

function readOnlyLabel(item: VariableInventoryItem): string | null {
  if (!item.catalogId || item.requirement === 'unknown') return 'Unknown · read-only';
  if (item.mutability === 'observed') return 'Observed · read-only';
  return null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('vi-VN');
}

export function VariableRow({ item }: { item: VariableInventoryItem }) {
  const readOnly = readOnlyLabel(item);
  const duplicateLabel = item.relatedDefinitionIds.length
    ? item.relatedDefinitionIds.join(', ')
    : 'Không có';

  return (
    <article className="panel variable-row" data-variable-name={item.name}>
      <div className="variable-row-header">
        <div>
          <p className="eyebrow">{item.appName}</p>
          <h3>{item.name}</h3>
          <p className="muted">{item.description}</p>
        </div>
        <div className="variable-badges">
          <span className={`level level-${item.sensitivity}`}>
            {sensitivityLabels[item.sensitivity]}
          </span>
          {readOnly ? <span className="variable-readonly">{readOnly}</span> : null}
        </div>
      </div>
      <div className="variable-value-block">
        <span className="variable-label">Giá trị hiện tại</span>
        <code className="variable-value">{item.value}</code>
      </div>
      <dl className="variable-metadata">
        <div>
          <dt>Source</dt>
          <dd>
            <strong>{item.sourcePathLabel}</strong>
            <span>{adapterLabels[item.sourceAdapter]}</span>
          </dd>
        </div>
        <div>
          <dt>App / category</dt>
          <dd>
            <strong>{item.appName}</strong>
            <span>{categoryLabels[item.category]}</span>
          </dd>
        </div>
        <div>
          <dt>Consumer</dt>
          <dd>{item.consumerIds.length ? item.consumerIds.join(', ') : 'Không có'}</dd>
        </div>
        <div>
          <dt>Function</dt>
          <dd>{item.functionIds.length ? item.functionIds.join(', ') : 'Không có'}</dd>
        </div>
        <div>
          <dt>Requirement / mutability</dt>
          <dd>
            <strong>{requirementLabels[item.requirement]}</strong>
            <span>{item.mutability === 'observed' ? 'Observed · read-only' : 'Managed'}</span>
          </dd>
        </div>
        <div>
          <dt>Apply effect</dt>
          <dd>{applyStrategyLabels[item.applyStrategy]}</dd>
        </div>
        <div>
          <dt>Effective precedence</dt>
          <dd>
            <strong>{item.precedence.effective ? 'Có hiệu lực' : 'Không có hiệu lực'}</strong>
            <span>
              {item.precedence.precedenceId} · rank {item.precedence.rank}
            </span>
          </dd>
        </div>
        <div>
          <dt>Trùng định nghĩa / Duplicates</dt>
          <dd>{duplicateLabel}</dd>
        </div>
        <div>
          <dt>Last change</dt>
          <dd>
            {item.lastOpsChange ? (
              <>
                <strong>{item.lastOpsChange.changeId}</strong>
                <span>
                  {item.lastOpsChange.actorUserId} · {formatDate(item.lastOpsChange.changedAt)}
                </span>
              </>
            ) : (
              'Chưa có thay đổi qua Ops'
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}
