import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import {
  classifyStudentIdentityRouteMutation,
  type StudentIdentityMutationSurface,
} from '../api/lib/maintenance/studentIdentityMutationInventory.js';
import { resolveApiRoute, type ApiHandlerId } from './routes.js';
import { rejectMutationDuringGlobalWriteFreeze } from './writeFreeze.js';

export interface CreateAppOptions {
  staticDir?: string;
  serveFrontend?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MUTATION_SURFACE_BY_HANDLER: Partial<Record<ApiHandlerId, StudentIdentityMutationSurface>> = {
  admissions: 'admissions',
  attendance: 'attendance',
  audit: 'audit_jobs',
  classes: 'classes',
  edu: 'education',
  files: 'student_face',
  finance: 'finance',
  'payments/payos': 'payments',
  students: 'students',
  zalo: 'messaging',
};
const EXTRA_MUTATING_AUDIT_READS = new Set([
  'admin-class-tuition-rebuild',
  'student-identity-health',
]);

function isLegacyMutatingApiRead(req: Request): boolean {
  if (req.method.toUpperCase() !== 'GET') return false;
  const pathname = req.originalUrl.split('?', 1)[0] || '';
  const resolution = resolveApiRoute(pathname);
  if (!resolution) return false;

  const action = resolution.query.action || '';
  if (resolution.handlerId === 'audit' && EXTRA_MUTATING_AUDIT_READS.has(action)) return true;

  const surface = MUTATION_SURFACE_BY_HANDLER[resolution.handlerId];
  if (!surface || !action) return false;
  return (
    classifyStudentIdentityRouteMutation({
      surface,
      resource: resolution.query.resource,
      action,
      method: req.method,
    }) !== 'read_only'
  );
}

function configuredPublicOrigins(): Set<string> {
  const configured = [process.env.APP_URL, process.env.PUBLIC_BASE_URL]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
  if (configured.length > 0) return new Set(configured);
  return process.env.NODE_ENV === 'production'
    ? new Set()
    : new Set(['http://localhost:3000', 'http://localhost:5173']);
}

function rejectCrossSiteMutation(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site')?.toLowerCase();
    const explicitCrossSite = fetchSite === 'cross-site';
    if (!explicitCrossSite && (!origin || configuredPublicOrigins().has(origin))) return next();

    res.status(403).json({ success: false, error: 'Cross-site request rejected' });
  };
}

function apiDispatcher(): RequestHandler {
  return async (req, res, next) => {
    // Express strips the mount path (`/api`) from req.path while this
    // middleware runs. The resolver intentionally consumes the original
    // public API path, so restore the mount prefix here.
    const route = resolveApiRoute(`${req.baseUrl}${req.path}`);
    if (!route) {
      res.status(404).json({ success: false, error: 'API route not found' });
      return;
    }

    // Express 5 khai bao req.query bang getter. Tao own-property tren chinh
    // IncomingMessage de handler nhan dung query da rewrite, trong khi
    // stream goc van nguyen ven cho formidable.
    const query = Object.assign(Object.create(null), req.query, route.query);
    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      value: query,
      writable: false,
    });

    try {
      await route.handler(req as never, res as never);
    } catch (error) {
      next(error);
    }
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const staticDir = path.resolve(options.staticDir ?? 'dist');
  const serveFrontend = options.serveFrontend ?? true;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('query parser', 'simple');

  // express.json/urlencoded tu bo qua multipart, nen formidable luon nhan raw
  // request stream. Gioi han nay chi ap cho body khong phai file upload.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  // Browser mutations carry Origin and Sec-Fetch-Site. Reject hostile origins
  // before route dispatch so cookie-authenticated APIs share one CSRF boundary.
  // Server-to-server webhooks and cron calls omit both headers and remain valid.
  app.use(
    '/api',
    rejectMutationDuringGlobalWriteFreeze({ isLegacyMutatingRead: isLegacyMutatingApiRead }),
    rejectCrossSiteMutation(),
    apiDispatcher()
  );

  if (serveFrontend) {
    if (!existsSync(path.join(staticDir, 'index.html'))) {
      throw new Error(`Frontend build not found: ${path.join(staticDir, 'index.html')}`);
    }
    app.use(express.static(staticDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      return res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = Number((error as { status?: unknown }).status || 500);
    const message = status >= 500 ? 'Internal server error' : String(error?.message || 'Bad request');
    res.status(status).json({ success: false, error: message });
  };
  app.use(errorHandler);

  return app;
}
