import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import fs from 'node:fs';

import { config } from './config';
import { logger } from './lib/logger';
import { getDb } from './db';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';

import { createBasicAuthMiddleware } from './middleware/basic-auth';
import { errorHandler } from './middleware/error';

import { bundlesRouter } from './routes/bundles';
import { cartRouter } from './routes/cart';
import { ordersRouter } from './routes/orders';
import { checkoutRouter } from './routes/checkout';
import { downloadsRouter } from './routes/downloads';
import { whopWebhookRouter } from './routes/webhooks-whop';

function buildApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Behind Traefik.

  // Structured request logging.
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Security headers. CSP is relaxed because we host a static marketing
  // site with inline styles + remote fonts; tighten later as T13 lands.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ───── Webhook FIRST (before JSON parser; needs raw body) ─────────────
  // Mounted under /api/webhooks/whop, exempt from basic auth + cookie parsing.
  app.use('/api/webhooks/whop', whopWebhookRouter);

  // ───── Login gate (subastas pattern) ──────────────────────────────────
  app.use(createBasicAuthMiddleware());

  // ───── Common parsers ────────────────────────────────────────────────
  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));

  // ───── Global API rate limit ─────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests' } },
  });
  app.use('/api/', apiLimiter);

  // ───── Health (Coolify health-check target) ──────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'paninipano',
      version: '0.1.0',
      whopConfigured: config.whop.configured,
      basicAuthEnabled: config.basicAuth.enabled,
      time: new Date().toISOString(),
    });
  });

  // ───── API routes ────────────────────────────────────────────────────
  app.use('/api/bundles', bundlesRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/checkout', checkoutRouter);
  app.use('/api/downloads', downloadsRouter);

  // ───── Static site ───────────────────────────────────────────────────
  // Serves the existing index.html + style.css + script.js + images + videos
  // from STATIC_ROOT. The app is path-agnostic — Traefik StripPrefix
  // removes `/paninipano` before requests arrive.
  if (fs.existsSync(path.join(config.staticRoot, 'index.html'))) {
    app.use(
      express.static(config.staticRoot, {
        index: 'index.html',
        // Don't auto-serve hidden files or our own server folder.
        dotfiles: 'ignore',
        // Mild caching — full bust on deploy via image tag.
        maxAge: config.isProd ? '1h' : 0,
      }),
    );
  } else {
    logger.warn(
      { staticRoot: config.staticRoot },
      'no index.html at static root — static serving disabled',
    );
  }

  // ───── 404 ───────────────────────────────────────────────────────────
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res
        .status(404)
        .json({ error: { code: 'not_found', message: `No route ${req.method} ${req.path}` } });
      return;
    }
    res.status(404).type('text/plain').send('Not Found');
  });

  // ───── Error middleware (LAST) ──────────────────────────────────────
  app.use(errorHandler);

  return app;
}

function start(): void {
  // Apply migrations on boot. Idempotent.
  runMigrations();
  getDb(); // warm-open

  // Seed the real catalog on boot. Idempotent (UPSERTs keyed on slug /
  // (bundle_id, slug)). Set SEED_ON_BOOT=false to skip — useful for
  // recovery scenarios where ops wants to mutate rows manually first.
  const seedOnBoot = process.env['SEED_ON_BOOT'] !== 'false';
  if (seedOnBoot) {
    try {
      seed();
    } catch (err) {
      // Don't take the process down on seed failure — log loudly and
      // continue. The API will surface bundle_not_found for affected
      // slugs, which is the same failure mode we already monitor for.
      logger.error({ err }, 'seed-on-boot failed');
    }
  } else {
    logger.warn('SEED_ON_BOOT=false — skipping catalog seed on boot');
  }

  const app = buildApp();
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        publicBaseUrl: config.publicBaseUrl,
        staticRoot: config.staticRoot,
        whopConfigured: config.whop.configured,
        basicAuthEnabled: config.basicAuth.enabled,
      },
      'paninipano server ready',
    );
  });

  // Graceful shutdown so in-flight downloads finish.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutdown initiated');
    server.close(() => {
      logger.info('http server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('forced exit after 10s');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start();
}

export { buildApp };
