// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StructurePanel } from './StructurePanel.js';
import type { DatabaseExplorerRelation } from '../../../../../packages/contracts/src/databaseExplorer.js';

afterEach(() => cleanup());

const mockRelation: DatabaseExplorerRelation = {
  name: 'users',
  kind: 'table',
  rowLevelSecurity: { enabled: true, forced: false },
  columns: [
    {
      name: 'id',
      dataType: 'uuid',
      nullable: false,
      hasDefault: true,
      identity: null,
      generated: false,
      classification: 'public',
      selectable: true,
      filterOperators: ['eq']
    },
    {
      name: 'phone',
      dataType: 'varchar(20)',
      nullable: true,
      hasDefault: false,
      identity: null,
      generated: false,
      classification: 'pii',
      selectable: true,
      filterOperators: ['eq', 'contains']
    },
    {
      name: 'password_hash',
      dataType: 'text',
      nullable: false,
      hasDefault: false,
      identity: null,
      generated: false,
      classification: 'blocked',
      selectable: false,
      filterOperators: []
    }
  ],
  constraints: [
    { name: 'pk_users', type: 'primary_key', definition: 'PRIMARY KEY (id)' },
    { name: 'uq_users_phone', type: 'unique', definition: 'UNIQUE (phone)' }
  ],
  indexes: [
    { name: 'idx_users_phone', definition: 'CREATE INDEX idx_users_phone ON users(phone)' }
  ],
  triggers: [],
  policies: [{ name: 'tenant_isolation', command: 'ALL', roles: ['public'] }],
  estimatedRows: 5000,
  dataAvailable: true,
  primaryKey: ['id'],
  paginationKey: ['id']
};

describe('StructurePanel component', () => {
  it('renders columns with PK badge and Never exposed badge for blocked column', () => {
    render(<StructurePanel schemaName="public" relation={mockRelation} />);

    expect(screen.getByText('public.users')).toBeInTheDocument();
    expect(screen.getByText('RLS: Bật')).toBeInTheDocument();
    expect(screen.getByText('~5000 dòng')).toBeInTheDocument();

    // Column id with PK badge
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('PK')).toBeInTheDocument();

    // Phone with PII badge
    expect(screen.getByText('phone')).toBeInTheDocument();
    expect(screen.getByText('PII')).toBeInTheDocument();

    // Password with Never exposed badge
    expect(screen.getByText('password_hash')).toBeInTheDocument();
    expect(screen.getByText('Never exposed')).toBeInTheDocument();

    // Constraints & Indexes & Policies
    expect(screen.getByText('pk_users')).toBeInTheDocument();
    expect(screen.getByText('idx_users_phone')).toBeInTheDocument();
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument();
  });

  it('renders empty state when no relation is selected', () => {
    render(<StructurePanel schemaName={null} relation={null} />);
    expect(screen.getByText('Chưa chọn bảng hoặc view nào.')).toBeInTheDocument();
  });
});
