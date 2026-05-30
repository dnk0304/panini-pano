import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { findOrderByProviderSession, loadOrder, setOrderProviderSession } from '../services/orders';
import { createCheckoutSession } from '../services/whop';
import { AppError, asyncHandler } from '../middleware/error';
import { config } from '../config';

export const checkoutRouter = Router();

/**
 * POST /api/checkout/whop
 *
 * Body: { orderId }
 *
 * Looks up the (pending) order, creates a Whop checkout session, stores
 * the session id on the order, returns { url } so the client can redirect.
 *
 * If Whop is unconfigured, returns a stub URL that hits the dev
 * mark-paid endpoint (handy for full-loop testing without an account).
 */

const bodySchema = z.object({
  orderId: z.string().uuid(),
});

checkoutRouter.post(
  '/whop',
  asyncHandler(async (req, res) => {
    const { orderId } = bodySchema.parse(req.body);
    const order = loadOrder(orderId);

    if (order.status !== 'pending') {
      throw new AppError(409, 'order_not_pending', `Order is ${order.status}`);
    }

    const items = getDb()
      .prepare(
        `SELECT oi.bundle_id, b.slug AS bundle_slug, oi.quantity
         FROM order_items oi JOIN bundles b ON b.id = oi.bundle_id
         WHERE oi.order_id = ?`,
      )
      .all(order.id) as Array<{ bundle_id: string; bundle_slug: string; quantity: number }>;

    if (items.length === 0) {
      throw new AppError(400, 'order_empty', 'Order has no items');
    }

    // MVP: Whop checkout sessions are single-product. If the cart contains
    // multiple bundles we'd need to either split orders OR use Whop's
    // multi-line API. For now, fail clearly.
    if (items.length > 1) {
      throw new AppError(
        501,
        'multi_bundle_not_supported',
        'Multi-bundle checkout via Whop not yet wired. Buyer must purchase one bundle at a time.',
      );
    }

    const it = items[0];
    if (!it) throw new AppError(500, 'internal_error', 'item lookup failed');

    const result = await createCheckoutSession({
      bundleId: it.bundle_id,
      orderId: order.id,
      quantity: it.quantity,
      email: order.customer_email,
      successUrl: config.whop.successUrl,
      cancelUrl: config.whop.cancelUrl,
    });

    setOrderProviderSession(order.id, result.sessionId);

    res.json({
      url: result.url,
      sessionId: result.sessionId,
      live: result.live,
      note: result.live
        ? undefined
        : 'Whop not configured — stub URL returned. See server/DEPLOY-COOLIFY.md for go-live steps.',
    });
  }),
);

// Convenience for debugging / Whop go-live verification.
checkoutRouter.get(
  '/whop/status',
  asyncHandler(async (_req, res) => {
    res.json({
      configured: config.whop.configured,
      mappedBundles: Object.keys(config.whop.productMap),
      successUrl: config.whop.successUrl ?? null,
      cancelUrl: config.whop.cancelUrl ?? null,
      webhookEndpoint: `${config.publicBaseUrl}/api/webhooks/whop`,
    });
  }),
);

// Re-export helper (used by webhook handler for idempotency on session-id).
export { findOrderByProviderSession };
