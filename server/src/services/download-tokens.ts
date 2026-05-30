import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Stateless signed download tokens.
 *
 * Token format (URL-safe base64 of JSON | base64url(HMAC-SHA256)):
 *   <payload>.<sig>
 *
 * Payload fields (JSON):
 *   eid  = entitlement_id
 *   exp  = expiry epoch seconds
 *   tid  = token_id (so we can revoke + audit if needed)
 *
 * Validation requires constant-time signature compare + expiry check.
 * No DB lookup is required to validate, but `tid` lets us reject revoked
 * tokens by checking download_tokens.revoked_at when desired.
 */

export interface DownloadTokenPayload {
  eid: string;
  exp: number;
  tid: string;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function sign(payload: string): string {
  return b64urlEncode(
    crypto
      .createHmac('sha256', config.downloads.signingSecret)
      .update(payload)
      .digest(),
  );
}

export function issueToken(entitlementId: string, tokenId: string): {
  token: string;
  expiresAt: Date;
} {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.downloads.ttlHours * 3600;
  const payload: DownloadTokenPayload = { eid: entitlementId, exp, tid: tokenId };
  const payloadStr = b64urlEncode(JSON.stringify(payload));
  const sig = sign(payloadStr);
  return {
    token: `${payloadStr}.${sig}`,
    expiresAt: new Date(exp * 1000),
  };
}

export type VerifyResult =
  | { ok: true; payload: DownloadTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyToken(token: string): VerifyResult {
  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) return { ok: false, reason: 'malformed' };

  const payloadStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadStr);

  // Constant-time compare.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as DownloadTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload.eid || !payload.exp || !payload.tid) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
