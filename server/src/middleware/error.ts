import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

/**
 * Typed application error. Use `throw new AppError(404, 'not_found', 'Cart not found')`
 * inside services/routes. The error middleware converts it to a consistent JSON shape.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Wrap async route handlers so thrown errors / rejected promises hit the
 * error middleware instead of crashing the event loop. Preserves Express's
 * default Request typing (params as ParamsDictionary) so route handlers
 * don't have to declare generics.
 */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/**
 * Pull a required URL param. Express + `noUncheckedIndexedAccess` types
 * `req.params.X` as `string | string[] | undefined`; this normalises to
 * a plain `string` (arrays come from `?a=1&a=2` style query, never path
 * params) and 400s if missing.
 */
export function requireParam(
  req: { params: Record<string, string | string[] | undefined> },
  key: string,
): string {
  const v = req.params[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].length > 0) return v[0];
  throw new AppError(400, 'missing_param', `Missing path parameter: ${key}`);
}

/**
 * Final error middleware. Always returns:
 *   { error: { code, message, requestId, details? } }
 *
 * 4xx = client. 5xx = server (stack logged, not returned).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Pull a request id (pino-http attaches one).
  const requestId =
    (req as unknown as { id?: string }).id ?? res.getHeader('x-request-id')?.toString() ?? '';

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.flatten(),
        requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  // Anything else is unexpected — log it, surface a generic message.
  logger.error({ err, requestId }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our end.',
      requestId,
    },
  });
};
