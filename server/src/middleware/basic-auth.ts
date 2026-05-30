import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config';

/**
 * Subastas-style temporary login gate. HTTP Basic Auth, env-driven.
 *
 *   - Skipped entirely if BASIC_AUTH_USER/PASS are unset OR
 *     DISABLE_BASIC_AUTH=true (dev convenience).
 *   - Constant-time credential compare.
 *   - `/api/webhooks/*` always exempt — webhooks have no Authorization
 *     header; HMAC signature verification protects them instead.
 *   - `/api/downloads/*` exempt — the signed token IS the auth, and the
 *     buyer is unauthenticated by definition.
 *   - `/api/health` exempt — Coolify health checks need to hit this without creds.
 *
 * To swap this for Traefik ForwardAuth (e.g. against dnkpartner's
 * `/api/auth/check`), just remove this middleware from index.ts and add a
 * Traefik label: `traefik.http.routers.paninipano.middlewares=...`.
 */
const EXEMPT_PREFIXES = [
  '/api/webhooks/',
  '/api/downloads/',
  '/api/health',
];

export function createBasicAuthMiddleware(): RequestHandler {
  if (!config.basicAuth.enabled) {
    // Pass-through — gate disabled.
    return (_req, _res, next) => next();
  }

  const expectedUser = Buffer.from(config.basicAuth.user, 'utf8');
  const expectedPass = Buffer.from(config.basicAuth.pass, 'utf8');

  return (req, res, next) => {
    // Mounted at the app root so we see the full path here.
    if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) {
      return next();
    }

    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) {
      return unauthorized(res);
    }

    let decoded: string;
    try {
      decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    } catch {
      return unauthorized(res);
    }
    const idx = decoded.indexOf(':');
    if (idx < 0) return unauthorized(res);
    const userBuf = Buffer.from(decoded.slice(0, idx), 'utf8');
    const passBuf = Buffer.from(decoded.slice(idx + 1), 'utf8');

    // timingSafeEqual requires equal length; pad to longest to avoid leaking length.
    if (!eqConstTime(userBuf, expectedUser) || !eqConstTime(passBuf, expectedPass)) {
      return unauthorized(res);
    }
    return next();
  };
}

function eqConstTime(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Mix in a dummy compare so timing leaks nothing about which differed.
    crypto.timingSafeEqual(Buffer.alloc(8), Buffer.alloc(8));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function unauthorized(res: import('express').Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="Panini Pano (preview)", charset="UTF-8"');
  res.status(401).type('text/plain').send('Authentication required');
}
