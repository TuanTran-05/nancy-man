import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import type { OpsStore } from '../storage/store.js';
import { encryptSecret } from '../security/crypto.js';
import {
  createOpsZaloLinkCode,
  hashZaloChatId,
  hashZaloLinkCode,
  parseOpsZaloLinkCommand,
} from '../security/zaloLink.js';
import { sendZaloText, type ZaloSendConfig } from '../alerts/zaloBotClient.js';
import { requireOpsSession, type AuthService, type SessionRequest } from './authRoutes.js';

export interface OpsZaloRouteConfig {
  botToken: string;
  webhookSecret: string;
  linkCodePepper: string;
  chatHashSecret: string;
  recipientKey: Buffer;
  timeoutMs: number;
  linkTtlSeconds: number;
}

export interface OpsZaloRouteDependencies {
  store: OpsStore;
  auth: AuthService;
  config: OpsZaloRouteConfig;
  now?: () => Date;
  confirmationSender?: (config: ZaloSendConfig, text: string) => Promise<{ messageId: string }>;
}

const idSchema = z.preprocess(
  (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : value),
  z.string().min(1).max(256),
);

const messageSchema = z.object({
  from: z.object({ id: idSchema, display_name: z.string().max(256).optional() }),
  chat: z.object({ id: idSchema, chat_type: z.enum(['PRIVATE', 'GROUP']) }),
  text: z.string().max(2000).optional(),
  message_id: idSchema,
}).passthrough();

const updateSchema = z.object({ event_name: z.string().min(1).max(128), message: messageSchema.optional() }).passthrough();
const webhookSchema = z.union([
  z.object({ ok: z.literal(true), result: updateSchema }).transform((value) => value.result),
  updateSchema,
]);

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function headerMatches(provided: string, expected: string): boolean {
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function readSecretHeader(request: Request): string {
  const value = request.headers['x-bot-api-secret-token'];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function ignored(response: Response, reason?: string): void {
  noStore(response);
  response.status(200).json(reason ? { ignored: true, reason } : { ignored: true });
}

export function attachZaloRoutes(router: Router, deps: OpsZaloRouteDependencies): void {
  const now = deps.now ?? (() => new Date());
  const confirmationSender = deps.confirmationSender ?? sendZaloText;
  const guard = requireOpsSession(deps.auth);

  router.get('/api/zalo/link', guard, (request: SessionRequest, response) => {
    noStore(response);
    const status = deps.store.getZaloLinkStatus(request.opsSession!.accountId);
    response.json(status ? { linked: true, linkedAt: status.linkedAt, lastSeenAt: status.lastSeenAt } : { linked: false });
  });

  router.post('/api/zalo/link-code', guard, (request: SessionRequest, response) => {
    noStore(response);
    const csrf = request.header('X-CSRF-Token');
    if (!csrf || !deps.auth.verifySessionCsrf(request.opsSession!, csrf)) {
      response.status(403).json({ error: 'csrf_required' });
      return;
    }
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + deps.config.linkTtlSeconds * 1000);
    const code = createOpsZaloLinkCode();
    deps.store.createZaloLinkCode({
      codeHash: hashZaloLinkCode(code, deps.config.linkCodePepper),
      accountId: request.opsSession!.accountId,
      expiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
    });
    deps.store.recordAuditEvent({
      actorId: request.opsSession!.accountId,
      action: 'zalo_link_code_created',
      target: request.opsSession!.accountId,
      details: { expiresAt: expiresAt.toISOString() },
      occurredAt: createdAt.toISOString(),
    });
    response.status(201).json({ code, expiresAt: expiresAt.toISOString(), command: `/link ${code}` });
  });

  router.delete('/api/zalo/link', guard, (request: SessionRequest, response) => {
    noStore(response);
    const csrf = request.header('X-CSRF-Token');
    if (!csrf || !deps.auth.verifySessionCsrf(request.opsSession!, csrf)) {
      response.status(403).json({ error: 'csrf_required' });
      return;
    }
    const at = now().toISOString();
    deps.store.disableZaloLink(request.opsSession!.accountId, at);
    deps.store.recordAuditEvent({ actorId: request.opsSession!.accountId, action: 'zalo_link_disabled', target: request.opsSession!.accountId, details: {}, occurredAt: at });
    response.status(204).end();
  });

  router.post('/api/zalo-bot/webhook', async (request, response) => {
    noStore(response);
    if (!headerMatches(readSecretHeader(request), deps.config.webhookSecret)) {
      response.status(403).json({ error: 'forbidden' });
      return;
    }
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'malformed_body' });
      return;
    }
    const message = parsed.data.message;
    if (!message) { ignored(response); return; }
    if (message.chat.chat_type === 'GROUP') { ignored(response, 'group_chat_not_supported'); return; }
    const code = message.text ? parseOpsZaloLinkCommand(message.text) : null;
    if (!code) { ignored(response, 'not_a_link_command'); return; }

    const at = now().toISOString();
    const result = deps.store.consumeZaloLink({
      codeHash: hashZaloLinkCode(code, deps.config.linkCodePepper),
      chatIdHash: hashZaloChatId(message.chat.id, deps.config.chatHashSecret),
      chatIdCiphertext: encryptSecret(message.chat.id, deps.config.recipientKey),
      eventId: message.message_id,
      now: at,
    });
    if (result.outcome === 'linked') {
      deps.store.recordAuditEvent({ actorId: result.accountId, action: 'zalo_linked', target: result.accountId, details: {}, occurredAt: at });
      void confirmationSender(
        { botToken: deps.config.botToken, recipientId: message.chat.id, timeoutMs: deps.config.timeoutMs },
        'Đã liên kết bot Ops Console thành công. Bạn sẽ nhận được cảnh báo vận hành tại đây.',
      ).catch(() => undefined);
      response.status(200).json({ success: true });
      return;
    }
    if (result.outcome === 'already_processed') {
      response.status(200).json({ success: true });
      return;
    }
    ignored(response);
  });
}
