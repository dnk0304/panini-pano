import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { loadOrder, markOrderPaid } from '../services/orders';
import { AppError, asyncHandler, requireParam } from '../middleware/error';

export const ordersRouter = Router();

/**
 * GET /api/orders/:id
 * Public-by-id but ids are UUIDv7 so they're not guessable. For real
 * launch, gate this behind an order-secret query param or magic-link.
 */
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = loadOrder(requireParam(req, 'id'));
    const items = getDb()
      .prepare(
        `SELECT oi.id, oi.bundle_id, b.slug AS bundle_slug, b.title AS bundle_title,
                oi.quantity, oi.unit_price_cents, oi.currency
         FROM order_items oi JOIN bundles b ON b.id = oi.bundle_id
         WHERE oi.order_id = ?`,
      )
      .all(order.id);
    res.json({ order, items });
  }),
);

/**
 * POST /api/orders/:id/mark-paid (STUB — dev-only convenience)
 *
 * Lets us exercise the fulfillment pipeline without a live Whop account.
 * Disabled in production (NODE_ENV check) — production uses the Whop
 * webhook at /api/webhooks/whop which HMAC-verifies the signature.
 */
const stubSchema = z.object({
  customerEmail: z.string().email().optional(),
});

ordersRouter.post(
  '/:id/mark-paid',
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(404, 'not_found', 'Not Found');
    }
    const body = stubSchema.parse(req.body ?? {});
    const result = await markOrderPaid({
      orderId: requireParam(req, 'id'),
      providerPaymentId: `stub_${Date.now()}`,
      customerEmail: body.customerEmail ?? null,
    });
    res.json(result);
  }),
);
