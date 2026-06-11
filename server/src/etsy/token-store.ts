import fs from 'node:fs';
import path from 'node:path';
import { etsyEnv } from './env';

/**
 * Persists the OAuth2 token set OUTSIDE git: server/data/etsy-tokens.json
 * (server/data/ is gitignored at both repo levels — verified).
 *
 * Etsy v3: access token TTL 1h, refresh token TTL 90 days. Refresh rotates
 * BOTH tokens — always persist the new refresh token immediately.
 */

export interface EtsyTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  obtained_at: string;
}

const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

function tokenPath(): string {
  const dataDir = path.resolve(__dirname, '..', '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'etsy-tokens.json');
}

export function loadTokens(): EtsyTokens | null {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as EtsyTokens;
}

export function saveTokens(raw: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): EtsyTokens {
  const tokens: EtsyTokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    // 60s safety margin so we never present an about-to-expire token.
    expires_at: Date.now() + (raw.expires_in - 60) * 1000,
    obtained_at: new Date().toISOString(),
  };
  fs.writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2));
  return tokens;
}

async function refreshTokens(refreshToken: string): Promise<EtsyTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: etsyEnv().keystring,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Etsy token refresh failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return saveTokens(json);
}

/**
 * Returns a valid access token, refreshing if expired.
 * Throws with a clear message if onboarding (etsy:oauth) hasn't run.
 */
export async function getAccessToken(): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'No Etsy tokens found. Run `npm run etsy:oauth` first (requires Dennis: ' +
        'redirect URI registered + consent click).',
    );
  }
  if (Date.now() >= tokens.expires_at) {
    tokens = await refreshTokens(tokens.refresh_token);
  }
  return tokens.access_token;
}
