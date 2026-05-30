import crypto from 'node:crypto';
import { config } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error';

/**
 * Whop client wrapper. Two responsibilities:
 *
 *  1. createCheckoutSession() — calls Whop's REST API to create a checkout
 *     URL for a buyer. Returns a stub object in dev when keys are missing.
 *
 *  2. verifyWebhookSignature() — HMAC-SHA256 verify of inbound webhooks.
 *     Constant-time compare. NEVER skip this in production.
 *
 * Whop API docs: https://dev.whop.com/api-reference
 * (If they change endpoint shape, only this file needs updating.)
 */

const WHOP_API_BASE = 'https://api.whop.com';

export interface CreateSessionInput {
  /** Bundle slug or id — we map to Whop product id via env config. */
  bundleId: string;
  /** Our internal order id; round-trips back via metadata. */
  orderId: string;
  /** Quantity (Whop usually expects 1; we pass it through). */
  quantity: number;
  /** Buyer email (Whop pre-fills if provided). */
  email?: string | null;
  /** Where Whop redirects after success/cancel. */
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateSessionResult {
  /** URL we redirect the buyer to. */
  url: string;
  /** Whop's session id (stored on the order). */
  sessionId: string;
  /** True when the call was real; false in stub mode. */
  live: boolean;
}

export async function createCheckoutSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  if (!config.whop.configured) {
    // STUB MODE — dev convenience. Returns a "checkout" URL that just
    // goes back to the order page; useful so the cart UI doesn't 500.
    const stubUrl = `${config.publicBaseUrl}/api/orders/${input.orderId}/mark-paid?_stub=1`;
    logger.warn({ orderId: input.orderId }, 'Whop not configured — returning stub checkout URL');
    return {
      url: stubUrl,
      sessionId: `stub_${input.orderId}`,
      live: false,
    };
  }

  const whopProductId = config.whop.productMap[input.bundleId];
  if (!whopProductId) {
    throw new AppError(
      500,
      'whop_product_not_mapped',
      `No Whop product id mapped for bundle "${input.bundleId}". ` +
        `Add it to WHOP_BUNDLE_PRODUCT_MAP_JSON env var.`,
    );
  }

  // Whop's checkout session endpoint. Shape per their REST docs as of 2026:
  //   POST /v5/checkout/sessions
  //   { plan_id, redirect_url, metadata, email? }
  // The exact field names may differ — keep this thin so swapping is trivial.
  const body = {
    plan_id: whopProductId,
    redirect_url: input.successUrl ?? config.whop.successUrl ?? `${config.publicBaseUrl}/checkout/success?order=${input.orderId}`,
    metadata: { order_id: input.orderId },
    email: input.email ?? undefined,
    quantity: input.quantity,
  };

  const resp = await fetch(`${WHOP_API_BASE}/v5/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whop.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<unreadable>');
    logger.error({ status: resp.status, body: text }, 'Whop checkout session failed');
    throw new AppError(
      502,
      'whop_upstream_error',
      'Failed to create Whop checkout session',
      { upstreamStatus: resp.status },
    );
  }

  const data = (await resp.json()) as { id?: string; checkout_url?: string; url?: string };
  const url = data.checkout_url ?? data.url;
  const sessionId = data.id;
  if (!url || !sessionId) {
    throw new AppError(502, 'whop_bad_response', 'Whop returned no checkout URL');
  }
  return { url, sessionId, live: true };
}

/**
 * HMAC-SHA256 verify a Whop webhook.
 *
 * Whop signs the raw request body with WHOP_WEBHOOK_SECRET and sends the
 * hex digest in the `whop-signature` header (variants: `Whop-Signature`,
 * `x-whop-signature`). We compute the same and constant-time compare.
 *
 * @param rawBody  the raw request body buffer (NOT JSON-parsed)
 * @param header   the value of the `whop-signature` header
 * @returns true if signature is valid; false otherwise.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!config.whop.webhookSecret) {
    logger.error('WHOP_WEBHOOK_SECRET not configured — refusing to accept webhooks');
    return false;
  }
  if (!header) return false;

  // Whop's header may be `t=...,v1=...` (Stripe-style) OR a bare hex digest.
  // Handle both. We extract v1=... when present, else use the whole value.
  let provided = header.trim();
  if (provided.includes('v1=')) {
    const parts = provided.split(',').map((p) => p.trim());
    const v1 = parts.find((p) => p.startsWith('v1='));
    if (!v1) return false;
    provided = v1.slice('v1='.length);
  }

  const expected = crypto
    .createHmac('sha256', config.whop.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expBuf = Buffer.from(expected, 'utf8');
  const givBuf = Buffer.from(provided, 'utf8');
  if (expBuf.length !== givBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, givBuf);
}
