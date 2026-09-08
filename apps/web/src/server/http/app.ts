import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import express, { type Express, type Request } from 'express';
import { resolve } from 'node:path';
import type { OpsStore } from '../storage/store.js';
import { attachAuthRoutes } from './authRoutes.js';
import { attachMonitorRoutes } from './monitorRoutes.js';
import type { AuthService } from './authRoutes.js';
import { attachZaloRoutes, type OpsZaloRouteDependencies } from './zaloRoutes.js';
import { attachInternalCanonicalRoutes } from './internalCanonicalRoutes.js';

type RequestWithRawBody = Request & { rawBody?: string };

export interface OpsAppDependencies {
  store: OpsStore;
  auth: AuthService;
  staticDir?: string;
  legacyBrowserApi?: boolean;
  canonicalApi?: Express;
  zalo?: OpsZaloRouteDependencies;
  internalMonitoring?: {
    secret: string;
    nonceCapacity?: number;
    now?: () => Date;
  };
  telemetry?: {
    captureException: (
      error: unknown,
      context: {
        code: string;
        source: 'api';
        route?: string;
        method?: string;
        status?: number;
      }
    ) => unknown;
    healthy: () => boolean;
  };
}

export function createOpsApp(deps: OpsAppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.get('/healthz', (_request, response) => {
    if (deps.telemetry && !deps.telemetry.healthy()) {
      response.status(503).json({ status: 'degraded', reason: 'telemetry_unavailable' });
      return;
    }
    response.status(200).json({ status: 'ok' });
  });
  app.use(
    express.json({
      limit: '64kb',
      strict: true,
      verify: (request, _response, buffer) => {
        (request as RequestWithRawBody).rawBody = buffer.toString('utf8');
      }
    })
  );
  const router = express.Router();
  const legacyBrowserApi = deps.legacyBrowserApi ?? true;
  if (legacyBrowserApi) {
    attachAuthRoutes(router, deps.auth);
    attachMonitorRoutes(router, deps.store, deps.auth);
  } else {
    router.all(
      [
        '/api/session',
        '/api/overview',
        '/api/infrastructure/history',
        '/api/incidents',
        '/api/incidents/:id/ack',
        '/api/zalo/link',
        '/api/zalo/link-code'
      ],
      (_request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.status(410).json({ error: 'legacy_route_retired' });
      }
    );
  }
  if (deps.zalo) attachZaloRoutes(router, deps.zalo, { legacyBrowserApi });
  if (deps.internalMonitoring) {
    attachInternalCanonicalRoutes(router, {
      store: deps.store,
      secret: deps.internalMonitoring.secret,
      ...(deps.internalMonitoring.nonceCapacity
        ? { nonceCapacity: deps.internalMonitoring.nonceCapacity }
        : {}),
      ...(deps.internalMonitoring.now ? { now: deps.internalMonitoring.now } : {}),
      zalo: deps.zalo
    });
  }
  app.use(router);
  if (deps.canonicalApi) app.use(deps.canonicalApi);
  if (deps.staticDir) {
    const staticRoot = resolve(deps.staticDir);
    app.get('/bootstrap/mfa', (_request, response, next) => {
      response.sendFile(
        resolve(staticRoot, 'index.html'),
        { etag: true, maxAge: '1h' },
        (error) => {
          if (error) next(error);
        }
      );
    });
    app.use(express.static(staticRoot, { index: 'index.html', etag: true, maxAge: '1h' }));
  }
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use(
    (error: unknown, request: Request, response: express.Response, next: express.NextFunction) => {
      try {
        deps.telemetry?.captureException(error, {
          code: 'OPS_WEB_UNHANDLED_EXCEPTION',
          source: 'api',
          route: request.path,
          method: request.method,
          status: 500
        });
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'api',
          status: 500,
          requestId: () => typeof response.locals?.requestId === 'string' ? response.locals.requestId : undefined,
          route: () => (request.originalUrl || request.url || '').split('?', 1)[0] || undefined,
          method: () => request.method,
        });
        // Reporting must not replace the safe response for the originating request.
      }
      if (response.headersSent) return next(error);
      return response.status(500).json({ error: 'internal_error' });
    }
  );
  return app;
}
