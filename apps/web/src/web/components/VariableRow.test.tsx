// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariableRow } from './VariableRow.js';

const item = {
  catalogId: 'ops.api_database_url',
  name: 'DATABASE_URL',
  value: 'postgres://synthetic-secret.example/ops',
  appId: 'ops',
  appName: 'Ops Console',
  functionIds: ['api.runtime'],
  sourceId: 'ops.api_env',
  sourcePathLabel: '/etc/edutrack-ops/api.env',
  sourceAdapter: 'systemd_environment_file' as const,
  consumerIds: ['ops.api'],
  category: 'database' as const,
  description: 'Synthetic database connection for the component test.',
  sensitivity: 'secret' as const,
  requirement: 'required' as const,
  mutability: 'observed' as const,
  applyStrategy: 'runtime_restart' as const,
  relatedDefinitionIds: ['ops.api_database_url_duplicate'],
  precedence: { precedenceId: 'ops.runtime_env', rank: 200, effective: true },
  sourceFingerprint: 'hmac-sha256:v1:' + 'a'.repeat(64),
  valueFingerprint: 'hmac-sha256:v1:' + 'b'.repeat(64),
  sourceMtime: '2026-08-31T12:00:00.000Z',
  lastOpsChange: {
    actorUserId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
    changeId: 'CHG_synthetic',
    changedAt: '2026-08-31T12:01:00.000Z'
  }
};

describe('VariableRow', () => {
  it('renders the complete value and operational metadata without edit controls', () => {
    render(<VariableRow item={item} />);

    expect(screen.getByText(item.value)).toBeInTheDocument();
    expect(screen.getByText('/etc/edutrack-ops/api.env')).toBeInTheDocument();
    expect(screen.getByText('ops.api')).toBeInTheDocument();
    expect(screen.getByText('api.runtime')).toBeInTheDocument();
    expect(screen.getAllByText('Observed · read-only')).toHaveLength(2);
    expect(screen.getByText('ops.api_database_url_duplicate')).toBeInTheDocument();
    expect(screen.getByText(/Có hiệu lực/i)).toBeInTheDocument();
    expect(screen.getByText(/CHG_synthetic/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Lưu|Xóa|Áp dụng|Sửa/i)).not.toBeInTheDocument();
  });

  it('marks discovered variables without a catalog entry as read-only unknowns', () => {
    render(
      <VariableRow
        item={{
          ...item,
          catalogId: undefined,
          name: 'DISCOVERED_FLAG',
          requirement: 'unknown',
          mutability: 'observed',
          relatedDefinitionIds: []
        }}
      />
    );

    expect(screen.getByText('Unknown · read-only')).toBeInTheDocument();
  });
});
