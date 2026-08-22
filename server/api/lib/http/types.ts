import type { Request, Response } from 'express';

/**
 * HTTP contract shared by the native VPS route dispatchers and handlers.
 *
 * Application request/response aliases for the native Express runtime.
 */
export type ApiRequest = Request & {
  body: any;
  query: Record<string, any>;
};

export type ApiResponse = Response;
