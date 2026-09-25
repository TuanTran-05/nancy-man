import { request } from '../../api.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseFilterOperator,
  DatabasePageSize,
  DatabaseRowsResponse,
  DatabaseTargetId,
  DatabaseTargetSummary
} from '../../../../../../packages/contracts/src/databaseExplorer.js';

export type DatabaseTargetsResponse = {
  targets: DatabaseTargetSummary[];
};

export type DatabaseRowsQueryInput = {
  schema: string;
  relation: string;
  pageSize: DatabasePageSize;
  cursor?: string;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters?: Array<{ column: string; operator: DatabaseFilterOperator; value?: string }>;
  piiMode?: 'masked' | 'revealed';
};

export type DatabaseRelatedRowsQueryInput = {
  schema: string;
  relation: string;
  constraint: string;
  rowRef: string;
  pageSize: DatabasePageSize;
  cursor?: string;
  piiMode?: 'masked' | 'revealed';
};

export type DatabasePiiRevealInput = {
  password: string;
  token: string;
  reason: string;
};

export type DatabasePiiRevealResult = {
  expiresAt: string;
};

export type DatabasePiiRevokeResult = {
  revoked: boolean;
};

export function getDatabaseTargets(): Promise<DatabaseTargetsResponse> {
  return request<DatabaseTargetsResponse>('/api/v1/database/targets');
}

export function getDatabaseSchema(
  targetId: DatabaseTargetId
): Promise<DatabaseExplorerSchemaSnapshot> {
  return request<DatabaseExplorerSchemaSnapshot>(
    `/api/v1/database/${encodeURIComponent(targetId)}/schema`
  );
}

export function queryDatabaseRows(
  targetId: DatabaseTargetId,
  body: DatabaseRowsQueryInput,
  csrfToken: string
): Promise<DatabaseRowsResponse> {
  return request<DatabaseRowsResponse>(
    `/api/v1/database/${encodeURIComponent(targetId)}/rows/query`,
    {
      method: 'POST',
      headers: {
        'X-Ops-CSRF': csrfToken
      },
      body: JSON.stringify(body)
    }
  );
}

export function queryRelatedRows(
  targetId: DatabaseTargetId,
  body: DatabaseRelatedRowsQueryInput,
  csrfToken: string
): Promise<DatabaseRowsResponse> {
  return request<DatabaseRowsResponse>(
    `/api/v1/database/${encodeURIComponent(targetId)}/relations/query`,
    {
      method: 'POST',
      headers: {
        'X-Ops-CSRF': csrfToken
      },
      body: JSON.stringify(body)
    }
  );
}

export function revealDatabasePii(
  targetId: DatabaseTargetId,
  body: DatabasePiiRevealInput,
  csrfToken: string
): Promise<DatabasePiiRevealResult> {
  return request<DatabasePiiRevealResult>(
    `/api/v1/database/${encodeURIComponent(targetId)}/pii-reveal`,
    {
      method: 'POST',
      headers: {
        'X-Ops-CSRF': csrfToken
      },
      body: JSON.stringify(body)
    }
  );
}

export function hideDatabasePii(
  csrfToken: string,
  options: { keepalive?: boolean } = {}
): Promise<DatabasePiiRevokeResult> {
  return request<DatabasePiiRevokeResult>('/api/v1/database/pii-reveal', {
    method: 'DELETE',
    ...(options.keepalive ? { keepalive: true } : {}),
    headers: {
      'X-Ops-CSRF': csrfToken
    }
  });
}
