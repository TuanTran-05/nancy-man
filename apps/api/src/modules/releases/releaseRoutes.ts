import express, { type NextFunction, type Request, type Response, type Router } from 'express';

type ReleaseResult =
  | { status: 201; accepted: true; releaseId: string }
  | { status: 400 | 401 | 403 | 413; accepted: false; code: string };

function rawBody(request: Request): string {
  return Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
}

function send(response: Response, result: ReleaseResult): void {
  const { status, ...payload } = result;
  response.status(status).json(payload);
}

export function createReleaseRouter(input: {
  register: (request: {
    keyId?: string;
    signature?: string;
    timestamp?: string;
    nonce?: string;
    rawBody: string;
  }) => Promise<ReleaseResult>;
}): Router {
  const router = express.Router();
  const body = express.raw({ type: 'application/json', limit: '25mb' });

  router.post('/', body, async (request, response, next) => {
    try {
      const keyId = request.get('X-Ops-Key-Id');
      const signature = request.get('X-Ops-Signature');
      const timestamp = request.get('X-Ops-Timestamp');
      const nonce = request.get('X-Ops-Nonce');
      send(
        response,
        await input.register({
          ...(keyId ? { keyId } : {}),
          ...(signature ? { signature } : {}),
          ...(timestamp ? { timestamp } : {}),
          ...(nonce ? { nonce } : {}),
          rawBody: rawBody(request)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.use(
    (error: { type?: string }, _request: Request, response: Response, next: NextFunction) => {
      if (error.type === 'entity.too.large') {
        response.status(413).json({ accepted: false, code: 'PAYLOAD_TOO_LARGE' });
        return;
      }
      next(error);
    }
  );

  return router;
}
