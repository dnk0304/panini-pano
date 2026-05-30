import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

/**
 * Strict env validation. App fails to boot if a required var is missing
 * or malformed. Optional vars get sensible defaults.
 *
 * Whop vars are OPTIONAL — when absent the app boots in "stub mode" and
 * surfaces a clear error if anyone tries to /api/checkout/whop.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3030),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3030'),
  STATIC_ROOT: z.string().optional(),
  DATA_DIR: z.string().default('./data'),

  BASIC_AUTH_USER: z.string().optional(),
  BASIC_AUTH_PASS: z.string().optional(),
  DISABLE_BASIC_AUTH: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  DOWNLOAD_SIGNING_SECRET: z
    .string()
    .min(32, 'DOWNLOAD_SIGNING_SECRET must be at least 32 chars'),
  DOWNLOAD_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),

  WHOP_API_KEY: z.string().optional(),
  WHOP_WEBHOOK_SECRET: z.string().optional(),
  WHOP_BUNDLE_PRODUCT_MAP_JSON: z.string().default('{}'),
  WHOP_SUCCESS_URL: z.string().url().optional(),
  WHOP_CANCEL_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

// Static root defaults to the parent of /server (where index.html lives).
const staticRoot = env.STATIC_ROOT
  ? path.resolve(env.STATIC_ROOT)
  : path.resolve(__dirname, '..', '..');

// Parse Whop bundle product map.
let whopProductMap: Record<string, string> = {};
try {
  whopProductMap = JSON.parse(env.WHOP_BUNDLE_PRODUCT_MAP_JSON) as Record<string, string>;
  if (typeof whopProductMap !== 'object' || Array.isArray(whopProductMap)) {
    throw new Error('must be a JSON object');
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('Invalid WHOP_BUNDLE_PRODUCT_MAP_JSON:', (err as Error).message);
  process.exit(1);
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  isProd: env.NODE_ENV === 'production',

  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
  staticRoot,
  dataDir: env.DATA_DIR,

  basicAuth: {
    enabled:
      !env.DISABLE_BASIC_AUTH &&
      Boolean(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASS),
    user: env.BASIC_AUTH_USER ?? '',
    pass: env.BASIC_AUTH_PASS ?? '',
  },

  downloads: {
    signingSecret: env.DOWNLOAD_SIGNING_SECRET,
    ttlHours: env.DOWNLOAD_TOKEN_TTL_HOURS,
  },

  whop: {
    configured: Boolean(env.WHOP_API_KEY && env.WHOP_WEBHOOK_SECRET),
    apiKey: env.WHOP_API_KEY ?? '',
    webhookSecret: env.WHOP_WEBHOOK_SECRET ?? '',
    productMap: whopProductMap,
    successUrl: env.WHOP_SUCCESS_URL,
    cancelUrl: env.WHOP_CANCEL_URL,
  },
} as const;

export type AppConfig = typeof config;
