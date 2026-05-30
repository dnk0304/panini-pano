import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Pretty output in dev; structured JSON in production.
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
  // Redact secrets if they ever leak into log objects.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      'config.basicAuth.pass',
      'config.downloads.signingSecret',
      'config.whop.apiKey',
      'config.whop.webhookSecret',
    ],
    remove: true,
  },
});
