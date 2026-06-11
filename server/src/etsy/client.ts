import { etsyEnv } from './env';
import { getAccessToken } from './token-store';

/**
 * Minimal Etsy v3 client.
 *
 * Auth model (live-verified 2026-06-11):
 *  - ALL requests:  x-api-key: <keystring>:<shared_secret>   (colon-joined;
 *    keystring alone returns 403 "Shared secret is required")
 *  - Write/private: additionally Authorization: Bearer <oauth access token>
 *
 * Handles 429 with Retry-After backoff (max 3 retries).
 */

const BASE = 'https://openapi.etsy.com/v3';

export class EtsyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Etsy API ${status} on ${url}: ${body.slice(0, 500)}`);
    this.name = 'EtsyApiError';
  }
}

export interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body (mutually exclusive with form). */
  json?: unknown;
  /** Multipart form body (uploads). */
  form?: FormData;
  /** Attach OAuth bearer token. Default false (public endpoints). */
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function etsyRequest<T>(pathname: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { 'x-api-key': etsyEnv().apiKeyHeader };
  if (opts.auth) headers['Authorization'] = `Bearer ${await getAccessToken()}`;

  // lib is ES2022-only (no DOM); RequestInit['body'] comes from @types/node's undici types.
  let body: string | FormData | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // fetch sets the multipart boundary header itself
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: opts.method ?? 'GET', headers, body });
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
      continue;
    }
    if (!res.ok) {
      throw new EtsyApiError(res.status, await res.text(), url.pathname);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** Public liveness check — verifies the colon-joined key works. */
export async function ping(): Promise<{ application_id: number }> {
  return etsyRequest<{ application_id: number }>('/application/openapi-ping');
}

/** Authenticated identity — used to resolve user_id and shop_id after OAuth. */
export async function getMe(): Promise<{ user_id: number; shop_id: number }> {
  return etsyRequest<{ user_id: number; shop_id: number }>('/application/users/me', {
    auth: true,
  });
}
