/**
 * Etsy credentials — lazy access. Scripts fail on FIRST USE, not at import,
 * so `tsc` / unrelated boot paths never require the secrets.
 *
 * Inject via environment only (CREDS.md is the source — NEVER commit):
 *   ETSY_KEYSTRING       — Etsy app client ID
 *   ETSY_SHARED_SECRET   — Etsy app shared secret
 *
 * Live-verified 2026-06-11: public v3 endpoints 403 with the keystring
 * alone; the working header is colon-joined `x-api-key: <keystring>:<secret>`.
 */

export interface EtsyEnv {
  keystring: string;
  sharedSecret: string;
  /** Colon-joined value for the x-api-key header. */
  apiKeyHeader: string;
}

let cached: EtsyEnv | null = null;

export function etsyEnv(): EtsyEnv {
  if (cached) return cached;
  const keystring = process.env.ETSY_KEYSTRING?.trim();
  const sharedSecret = process.env.ETSY_SHARED_SECRET?.trim();
  if (!keystring || !sharedSecret) {
    throw new Error(
      'Missing ETSY_KEYSTRING / ETSY_SHARED_SECRET. Inject from CREDS.md ' +
        '(niki/PROJECTS/panini-pano/CREDS.md) via environment — never commit them.',
    );
  }
  cached = { keystring, sharedSecret, apiKeyHeader: `${keystring}:${sharedSecret}` };
  return cached;
}

/** OAuth callback port — must match the redirect URI registered in Etsy app settings. */
export const ETSY_OAUTH_PORT = Number(process.env.ETSY_OAUTH_PORT ?? 4477);
export const ETSY_REDIRECT_URI = `http://localhost:${ETSY_OAUTH_PORT}/callback`;
export const ETSY_SCOPES = ['listings_w', 'listings_r', 'shops_r', 'shops_w'] as const;
