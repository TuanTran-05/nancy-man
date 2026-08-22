import express, { type NextFunction, type Request, type Response, type Router } from 'express';

type BrowserResult =
  | { status: number; accepted: true; duplicate: boolean; eventId: string }
  | { status: number; accepted: false; code: string };
type ServerResult =
  | { status: number; accepted: true; duplicate: boolean; eventId: string }
  | { status: number; accepted: false; code: string };
type ServerBatchResult =
  | {
      status: number;
      accepted: number;
      rejected: number;
      results: Array<{ accepted: true; eventId: string; duplicate: boolean } | { accepted: false; code: string }>;
    }
  | { status: number; accepted: false; code: string };

type RequestBody = {
  keyId?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  clientIp: string;
  rawBody: string;
};

function rawBody(request: Request): string {
  return Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function setBrowserCors(response: Response, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ops-Project-Key');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Vary', 'Origin');
}

function send(response: Response, result: BrowserResult | ServerResult | ServerBatchResult): void {
  const { status, ...payload } = result;
  response.status(status).json(payload);
}

export function createIngestRouter(input: {
  browser: { ingest: (request: { origin?: string; projectKey?: string; clientIp: string; rawBody: string }) => Promise<BrowserResult> };
  server: {
    ingest: (request: RequestBody) => Promise<ServerResult>;
    ingestBatch: (request: RequestBody) => Promise<ServerBatchResult>;
  };
  browserCorsOrigins: readonly string[];
}): Router {
  const router = express.Router();
  const browserBody = express.raw({ type: 'application/json', limit: '64kb' });
  const serverBody = express.raw({ type: 'application/json', limit: '5mb' });
  const browserOrigins = new Set(input.browserCorsOrigins);

  router.options('/browser', (request, response) => {
    const origin = request.get('origin');
    if (!origin || !browserOrigins.has(origin)) {
      response.status(403).json({ accepted: false, code: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    setBrowserCors(response, origin);
    response.status(204).end();
  });

  router.post('/browser', browserBody, async (request, response, next) => {
    try {
      const origin = request.get('origin');
      const projectKey = request.get('X-Ops-Project-Key');
      const result = await input.browser.ingest({
        ...(origin ? { origin } : {}),
        ...(projectKey ? { projectKey } : {}),
        clientIp: clientIp(request),
        rawBody: rawBody(request)
      });
      if (origin && browserOrigins.has(origin)) {
        setBrowserCors(response, origin);
      }
      send(response, result);
    } catch (error) {
      next(error);
    }
  });

  const serverRequest = (request: Request): RequestBody => {
    const keyId = request.get('X-Ops-Key-Id');
    const signature = request.get('X-Ops-Signature');
    const timestamp = request.get('X-Ops-Timestamp');
    const nonce = request.get('X-Ops-Nonce');
    return {
      ...(keyId ? { keyId } : {}),
      ...(signature ? { signature } : {}),
      ...(timestamp ? { timestamp } : {}),
      ...(nonce ? { nonce } : {}),
      clientIp: clientIp(request),
      rawBody: rawBody(request)
    };
  };

  router.post('/server', serverBody, async (request, response, next) => {
    try {
      send(response, await input.server.ingest(serverRequest(request)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/server/batch', serverBody, async (request, response, next) => {
    try {
      send(response, await input.server.ingestBatch(serverRequest(request)));
    } catch (error) {
      next(error);
    }
  });

  router.use((error: { type?: string }, _request: Request, response: Response, next: NextFunction) => {
    if (error.type === 'entity.too.large') {
      response.status(413).json({ accepted: false, code: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    next(error);
  });

  return router;
}
