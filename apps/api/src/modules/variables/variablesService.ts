import type {
  AgentActor,
  InventoryReadResponse
} from '../../../../../packages/config-contracts/src/agentProtocol.js';
import type { Catalog } from '../../../../../packages/config-contracts/src/catalog.js';
import { ConfigAgentError } from '../../infrastructure/configAgentClient.js';

const sensitiveMetadataKeys = new Set(['value', 'currentValue', 'credential', 'agentResponse']);

export type VariablesAudit = {
  append: (input: {
    actorUserId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
};

export class VariablesServiceError extends Error {
  constructor(readonly code: 'CONFIG_AGENT_UNAVAILABLE' | 'CONFIG_AGENT_PROTOCOL_ERROR') {
    super(code);
    this.name = 'VariablesServiceError';
  }
}

export function redactVariablesMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactVariablesMetadata(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveMetadataKeys.has(key) ? '[redacted]' : redactVariablesMetadata(item)
    ])
  );
}

function stableSourceIds(response: InventoryReadResponse): string[] {
  return [...new Set(response.items.map((item) => item.sourceId))].sort();
}

function agentErrorCode(error: unknown): VariablesServiceError['code'] {
  if (error instanceof ConfigAgentError) {
    return error.code === 'AGENT_CONNECT_TIMEOUT' ||
      error.code === 'AGENT_CONNECT_FAILED' ||
      error.code === 'AGENT_READ_TIMEOUT' ||
      error.code === 'AGENT_TOTAL_TIMEOUT'
      ? 'CONFIG_AGENT_UNAVAILABLE'
      : 'CONFIG_AGENT_PROTOCOL_ERROR';
  }
  return 'CONFIG_AGENT_UNAVAILABLE';
}

export class VariablesService {
  private readonly audit: VariablesAudit | undefined;

  constructor(
    private readonly input: {
      client: {
        readInventory: (actor: AgentActor) => Promise<InventoryReadResponse>;
      };
      catalog: Catalog;
      audit?: VariablesAudit;
    }
  ) {
    this.audit = input.audit;
  }

  async getCatalog(): Promise<Catalog> {
    return this.input.catalog;
  }

  async read(input: { actor: AgentActor }): Promise<InventoryReadResponse> {
    try {
      const response = await this.input.client.readInventory(input.actor);
      await this.audit?.append({
        actorUserId: input.actor.userId,
        action: 'variables.inventory_read',
        subjectType: 'variables_inventory',
        metadata: redactVariablesMetadata({
          sessionId: input.actor.sessionId,
          sourceIds: stableSourceIds(response),
          itemCount: response.items.length,
          catalogVersion: response.catalogVersion,
          manifestVersion: response.manifestVersion,
          code: 'SUCCESS'
        }) as Record<string, unknown>
      });
      return response;
    } catch (error) {
      const code = agentErrorCode(error);
      await this.audit?.append({
        actorUserId: input.actor.userId,
        action: 'variables.inventory_read_failed',
        subjectType: 'variables_inventory',
        metadata: redactVariablesMetadata({
          sessionId: input.actor.sessionId,
          sourceIds: [],
          itemCount: 0,
          catalogVersion: this.input.catalog.catalogVersion,
          manifestVersion: 'unknown',
          code
        }) as Record<string, unknown>
      });
      throw new VariablesServiceError(code);
    }
  }
}
