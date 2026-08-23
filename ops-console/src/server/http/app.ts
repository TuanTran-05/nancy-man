import express, { type Express } from 'express';
import { resolve } from 'node:path';
import type { OpsStore } from '../storage/store.js';
import { attachAuthRoutes } from './authRoutes.js';
import { attachMonitorRoutes } from './monitorRoutes.js';
import type { AuthService } from './authRoutes.js';

export interface OpsAppDependencies {
  store: OpsStore;
  auth: AuthService;
  staticDir?: string;
}

export function createOpsApp(deps: OpsAppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb', strict: true }));
  const router = express.Router();
  attachAuthRoutes(router, deps.auth);
  attachMonitorRoutes(router, deps.store, deps.auth);
  app.use(router);
  if (deps.staticDir) {
    app.use(express.static(resolve(deps.staticDir), { index: 'index.html', etag: true, maxAge: '1h' }));
  }
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  return app;
}
