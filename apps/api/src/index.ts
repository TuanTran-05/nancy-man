import express, { type ErrorRequestHandler } from 'express';

import { createIngestRouter } from './modules/ingest/ingestRoutes.js';
import { createReleaseRouter } from './modules/releases/releaseRoutes.js';

export function createOpsApi(input: {
  ingest: Parameters<typeof createIngestRouter>[0];
  releases?: Parameters<typeof createReleaseRouter>[0];
  trustedProxy?: string | readonly string[];
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set(
    'trust proxy',
    input.trustedProxy
      ? typeof input.trustedProxy === 'string'
        ? input.trustedProxy
        : [...input.trustedProxy]
      : false
  );
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });
  app.use('/api/v1/ingest', createIngestRouter(input.ingest));
  if (input.releases) {
    app.use('/api/v1/releases', createReleaseRouter(input.releases));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    response.status(500).json({ accepted: false, code: 'INTERNAL_ERROR' });
  };
  app.use(errorHandler);
  return app;
}
