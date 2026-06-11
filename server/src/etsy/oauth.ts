import crypto from 'node:crypto';
import { etsyEnv, ETSY_REDIRECT_URI, ETSY_SCOPES } from './env';
import { saveTokens, type EtsyTokens } from './token-store';

/**
 * Etsy v3 OAuth2 — authorization code + PKCE (S256).
 * Docs: https://developers.etsy.com/documentation/essentials/authentication
 */

const AUTH_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkce(): PkcePair {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export function buildConsentUrl(pkce: PkcePair): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', etsyEnv().keystring);
  url.searchParams.set('redirect_uri', ETSY_REDIRECT_URI);
  url.searchParams.set('scope', ETSY_SCOPES.join(' '));
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<EtsyTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: etsyEnv().keystring,
      redirect_uri: ETSY_REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Etsy code exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return saveTokens(json);
}
