import express, { type Router } from 'express';
import { z } from 'zod';

import type { SqlWorkerActor } from '../../../../../packages/contracts/src/workerProtocol.js';
import { assertPermission, type OpsRole } from '../../../../../packages/security/src/sessions.js';

type SchemaPrincipal = {
  userId: string;
  sessionId: string;
  role: OpsRole;
};

const schemaSnapshot = z
  .object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    schemas: z.array(
      z
        .object({
          name: z.string().min(1).max(63),
          relations: z.array(
            z
              .object({
                name: z.string().min(1).max(63),
                kind: z.enum([
                  'table',
                  'partitioned_table',
                  'view',
                  'materialized_view',
                  'foreign_table'
                ]),
                rowLevelSecurity: z.object({ enabled: z.boolean(), forced: z.boolean() }).strict(),
                columns: z.array(
                  z
                    .object({
                      name: z.string().min(1).max(63),
                      dataType: z.string().min(1).max(256),
                      nullable: z.boolean(),
                      hasDefault: z.boolean(),
                      identity: z.enum(['always', 'by_default']).nullable(),
                      generated: z.boolean()
                    })
                    .strict()
                ),
                constraints: z.array(
                  z
                    .object({
                      name: z.string().min(1).max(63),
                      kind: z.enum(['primary_key', 'unique', 'foreign_key', 'check']),
                      columns: z.array(z.string().min(1).max(63)),
                      referencedRelation: z
                        .object({
                          schema: z.string().min(1).max(63),
                          name: z.string().min(1).max(63),
                          columns: z.array(z.string().min(1).max(63))
                        })
                        .strict()
                        .nullable(),
                      deferrable: z.boolean(),
                      initiallyDeferred: z.boolean()
                    })
                    .strict()
                ),
                indexes: z.array(
                  z
                    .object({
                      name: z.string().min(1).max(63),
                      method: z.string().min(1).max(63),
                      columns: z.array(z.string().min(1).max(63)),
                      unique: z.boolean(),
                      primary: z.boolean(),
                      valid: z.boolean(),
                      hasExpressions: z.boolean(),
                      partial: z.boolean()
                    })
                    .strict()
                ),
                triggers: z.array(
                  z
                    .object({
                      name: z.string().min(1).max(63),
                      timing: z.enum(['before', 'after', 'instead_of']),
                      events: z.array(z.enum(['insert', 'update', 'delete', 'truncate'])),
                      enabled: z.enum(['enabled', 'disabled', 'replica', 'always'])
                    })
                    .strict()
                ),
                policies: z.array(
                  z
                    .object({
                      name: z.string().min(1).max(63),
                      command: z.enum(['all', 'select', 'insert', 'update', 'delete']),
                      permissive: z.boolean(),
                      roles: z.array(z.string().min(1).max(63))
                    })
                    .strict()
                )
              })
              .strict()
          )
        })
        .strict()
    )
  })
  .strict();

export function createSchemaRouter(input: {
  authorize: (input: {
    cookieHeader?: string;
    csrfToken?: string;
    mutation: boolean;
  }) => Promise<SchemaPrincipal | null>;
  worker: {
    command: (input: {
      actor: SqlWorkerActor;
      kind: 'schema.read';
      payload: Record<string, never>;
    }) => Promise<
      | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
      | {
          protocolVersion: 1;
          commandId: string;
          ok: false;
          error: { code: string; safeMessage: string };
        }
    >;
  };
}): Router {
  const router = express.Router();
  router.get('/schema', async (request, response, next) => {
    try {
      const cookieHeader = request.get('cookie');
      const principal = await input.authorize({
        ...(cookieHeader ? { cookieHeader } : {}),
        mutation: false
      });
      if (!principal) return response.status(401).json({ code: 'AUTH_DENIED' });
      try {
        assertPermission(principal.role, 'sql:read');
      } catch {
        return response.status(403).json({ code: 'PERMISSION_DENIED' });
      }
      const worker = await input.worker.command({
        actor: {
          userId: principal.userId,
          sessionId: principal.sessionId,
          role: principal.role
        },
        kind: 'schema.read',
        payload: {}
      });
      if (!worker.ok) return response.status(503).json({ code: worker.error.code });
      const parsed = schemaSnapshot.safeParse(worker.result);
      if (!parsed.success) return response.status(503).json({ code: 'WORKER_SCHEMA_INVALID' });
      return response.status(200).json(parsed.data);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
