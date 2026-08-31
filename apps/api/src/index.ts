import express, { type ErrorRequestHandler } from 'express';

import { createIngestRouter } from './modules/ingest/ingestRoutes.js';
import { createIssueRouter } from './modules/issues/issueRoutes.js';
import { createAuthRouter } from './modules/auth/authRoutes.js';
import { createReleaseRouter } from './modules/releases/releaseRoutes.js';
import { createSqlRouter } from './modules/sql/sqlRoutes.js';
import { createSchemaRouter } from './modules/database/schemaRoutes.js';
import { createIncidentRouter } from './modules/incidents/incidentRoutes.js';
import { createAccountRouter } from './modules/accounts/accountRoutes.js';
import { createMonitoringRouter } from './modules/monitoring/monitoringRoutes.js';
import { createVariablesRouter } from './modules/variables/variablesRoutes.js';
import { createConfigChangeRouter } from './modules/variables/configChangeRoutes.js';

export function createOpsApi(input: {
  ingest: Parameters<typeof createIngestRouter>[0];
  releases?: Parameters<typeof createReleaseRouter>[0];
  auth?: Parameters<typeof createAuthRouter>[0];
  issues?: Parameters<typeof createIssueRouter>[0];
  incidents?: Parameters<typeof createIncidentRouter>[0];
  database?: Parameters<typeof createSchemaRouter>[0];
  sql?: Parameters<typeof createSqlRouter>[0];
  accounts?: Parameters<typeof createAccountRouter>[0];
  monitoring?: Parameters<typeof createMonitoringRouter>[0];
  variables?: Parameters<typeof createVariablesRouter>[0];
  configChanges?: Parameters<typeof createConfigChangeRouter>[0];
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
  if (input.auth) app.use('/api/v1/auth', createAuthRouter(input.auth));
  if (input.accounts) app.use('/api/v1/users', createAccountRouter(input.accounts));
  if (input.monitoring) app.use('/api/v1', createMonitoringRouter(input.monitoring));
  if (input.variables) app.use('/api/v1', createVariablesRouter(input.variables));
  if (input.configChanges) app.use('/api/v1', createConfigChangeRouter(input.configChanges));
  if (input.issues) app.use('/api/v1/issues', createIssueRouter(input.issues));
  if (input.incidents) app.use('/api/v1/incidents', createIncidentRouter(input.incidents));
  if (input.database) app.use('/api/v1/database', createSchemaRouter(input.database));
  if (input.sql) app.use('/api/v1/sql', createSqlRouter(input.sql));
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
