import { Router, raw } from 'express';
import { getDb } from '../db';
import { findOrderByProviderSession, markOrderPaid } from '../services/orders';
import { verifyWebhookSignature } from '../services/whop';
import { newId } from '../lib/ids';
import { logger } from '../lib/logger';
import { AppError, asyncHandler } from '../middleware/error';

export const whopWebhookRouter = Router();

/**
 * POST /api/webhooks/whop
 *
 * Whop POSTs JSON event objects here. We:
 *   1. Capture the RAW body (raw parser — needed for HMAC).
 *   2. Verify the `whop-signature` header against WHOP_WEBHOOK_SECRET.
 *   3. Dedupe by event id (webhook_events table).
 *   4. On payment-succeeded events, look up the order via metadata.order_id
 *      OR via provider_session_id, then mark it paid.
 *
 * IMPORTANT: this route MUST be mounted BEFORE the global express.json()
 * parser (or with its own raw parser, as below) so we get the raw bytes.
 *
 * Basic-auth middleware MUST exclude this path so Whop can reach it.
 */
whopWebhookRouter.post(
  '/',
  raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const rawBody = req.body as Buffer;
    const sig =
      (req.header('whop-signature') ??
        req.header('Whop-Signature') ??
        req.header('x-whop-signature')) ||
      undefined;

    if (!verifyWebhookSignature(rawBody, sig)) {
      logger.warn({ ip: req.ip }, 'whop webhook: signature verification failed');
      throw new AppError(401, 'bad_signature', 'Invalid signature');
    }

    // Parse JSON ourselves (raw parser left it as a Buffer).
    let payload: WhopEvent;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WhopEvent;
    } catch {
      throw new AppError(400, 'bad_json', 'Body is not valid JSON');
    }

    const eventId = payload.id ?? `nohdr_${newId()}`;
    const eventType = payload.type ?? payload.action ?? 'unknown';

    const db = getDb();

    // Idempotency: insert OR ignore on duplicate event id.
    const existing = db
      .prepare(`SELECT id, processed_at FROM webhook_events WHERE id = ?`)
      .get(eventId) as { id: string; processed_at: string | null } | undefined;

    if (existing?.processed_at) {
      res.json({ received: true, dedup: true });
      return;
    }

    if (!existing) {
      db.prepare(
        `INSERT INTO webhook_events (id, provider, event_type, payload_json)
         VALUES (?, 'whop', ?, ?)`,
      ).run(eventId, eventType, rawBody.toString('utf8'));
    }

    // Only "payment succeeded" events flip the order. Everything else is
    // recorded but ignored for now.
    const isPaymentSuccess =
      eventType === 'payment.succeeded' ||
      eventType === 'membership.went_valid' ||
      eventType === 'payment_succeeded';

    if (!isPaymentSuccess) {
      db.prepare(
        `UPDATE webhook_events SET processed_at = datetime('now') WHERE id = ?`,
      ).run(eventId);
      res.json({ received: true, ignored: true, eventType });
      return;
    }

    const data = payload.data ?? {};
    const metadataOrderId =
      data.metadata?.order_id ?? payload.metadata?.order_id ?? null;
    const sessionId =
      data.checkout_session_id ??
      data.session_id ??
      data.id ??
      payload.checkout_session_id ??
      null;
    const providerPaymentId = data.payment_id ?? data.id ?? null;
    const customerEmail = data.email ?? data.customer_email ?? null;

    let orderId = metadataOrderId;
    if (!orderId && sessionId) {
      const order = findOrderByProviderSession(sessionId);
      if (order) orderId = order.id;
    }

    if (!orderId) {
      logger.warn(
        { eventId, eventType, sessionId },
        'whop webhook: payment event without resolvable order id',
      );
      db.prepare(
        `UPDATE webhook_events SET processed_at = datetime('now'),
                                    process_error = 'no resolvable order'
         WHERE id = ?`,
      ).run(eventId);
      // 200 anyway — Whop should not retry forever on our schema issues.
      res.json({ received: true, unresolved: true });
      return;
    }

    try {
      const result = await markOrderPaid({
        orderId,
        providerPaymentId,
        customerEmail,
      });
      db.prepare(
        `UPDATE webhook_events SET processed_at = datetime('now') WHERE id = ?`,
      ).run(eventId);
      res.json({ received: true, orderId, ...result });
    } catch (err) {
      db.prepare(
        `UPDATE webhook_events SET processed_at = datetime('now'),
                                    process_error = ?
         WHERE id = ?`,
      ).run((err as Error).message, eventId);
      throw err;
    }
  }),
);

// Shape Whop sends — kept loose because we adapt to several event variants.
interface WhopEvent {
  id?: string;
  type?: string;
  action?: string;
  metadata?: { order_id?: string };
  checkout_session_id?: string;
  data?: {
    id?: string;
    payment_id?: string;
    checkout_session_id?: string;
    session_id?: string;
    email?: string;
    customer_email?: string;
    metadata?: { order_id?: string };
  };
}
