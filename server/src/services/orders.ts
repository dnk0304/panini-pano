import path from 'node:path';
import fs from 'node:fs';
import { getDb } from '../db';
import { newId } from '../lib/ids';
import { config } from '../config';
import { logger } from '../lib/logger';
import { issueToken } from './download-tokens';
import { packageBundle, type PrintInput } from './pdf-packager';
import { AppError } from '../middleware/error';

/**
 * Lifecycle:
 *
 *   pending  → created at /api/cart/:id/checkout
 *   paid     → Whop webhook (payment.succeeded) calls markOrderPaid()
 *   fulfilled → packages built + entitlements + download token issued
 *
 * Idempotency: webhook_events table dedupes provider events. markOrderPaid()
 * is itself idempotent — re-calling on a paid order is a no-op.
 */

export interface OrderRow {
  id: string;
  cart_id: string | null;
  customer_email: string | null;
  status: 'pending' | 'paid' | 'fulfilled' | 'refunded' | 'cancelled';
  total_cents: number;
  currency: string;
  payment_provider: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

export function loadOrder(orderId: string): OrderRow {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, cart_id, customer_email, status, total_cents, currency,
              payment_provider, provider_session_id, provider_payment_id,
              paid_at, fulfilled_at, created_at, updated_at
       FROM orders WHERE id = ?`,
    )
    .get(orderId) as OrderRow | undefined;
  if (!row) throw new AppError(404, 'order_not_found', `Order ${orderId} not found`);
  return row;
}

export function findOrderByProviderSession(sessionId: string): OrderRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, cart_id, customer_email, status, total_cents, currency,
              payment_provider, provider_session_id, provider_payment_id,
              paid_at, fulfilled_at, created_at, updated_at
       FROM orders WHERE provider_session_id = ?`,
    )
    .get(sessionId) as OrderRow | undefined;
  return row ?? null;
}

export function setOrderProviderSession(orderId: string, sessionId: string): void {
  getDb()
    .prepare(
      `UPDATE orders SET provider_session_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(sessionId, orderId);
}

/**
 * Mark an order paid and build its packages + entitlements + download token.
 * Returns the issued download URL (full external link) on success.
 * Idempotent: replay-safe.
 */
export async function markOrderPaid(input: {
  orderId: string;
  providerPaymentId: string | null;
  customerEmail?: string | null;
}): Promise<{ alreadyFulfilled: boolean; downloadUrls: { bundleSlug: string; url: string; expiresAt: string }[] }> {
  const db = getDb();
  const order = loadOrder(input.orderId);

  if (order.status === 'fulfilled') {
    const existing = listDownloadUrlsForOrder(order.id);
    return { alreadyFulfilled: true, downloadUrls: existing };
  }

  // Mark paid (idempotent: paid_at only set if null).
  db.prepare(
    `UPDATE orders
     SET status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END,
         paid_at = COALESCE(paid_at, datetime('now')),
         provider_payment_id = COALESCE(provider_payment_id, ?),
         customer_email = COALESCE(customer_email, ?),
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(input.providerPaymentId, input.customerEmail ?? null, order.id);

  // Build packages for each ordered bundle (one per bundleId — quantity > 1
  // still delivers the same files; the buyer gets unlimited downloads within
  // the token TTL).
  const items = db
    .prepare(
      `SELECT oi.bundle_id, b.slug AS bundle_slug, b.title AS bundle_title
       FROM order_items oi JOIN bundles b ON b.id = oi.bundle_id
       WHERE oi.order_id = ?`,
    )
    .all(order.id) as Array<{ bundle_id: string; bundle_slug: string; bundle_title: string }>;

  const downloadUrls: { bundleSlug: string; url: string; expiresAt: string }[] = [];

  for (const it of items) {
    const ent = upsertEntitlement(order.id, it.bundle_id);

    if (!ent.package_path || !fs.existsSync(ent.package_path)) {
      const prints = db
        .prepare(
          `SELECT id, slug, title, source_path
           FROM prints WHERE bundle_id = ? AND deleted_at IS NULL
           ORDER BY sort_order`,
        )
        .all(it.bundle_id) as Array<{
          id: string;
          slug: string;
          title: string;
          source_path: string;
        }>;

      if (prints.length === 0) {
        logger.warn({ bundleId: it.bundle_id }, 'no prints in bundle — skipping package build');
        continue;
      }

      const outDir = path.join(
        path.resolve(config.dataDir),
        'packages',
        order.id,
        it.bundle_slug,
      );

      try {
        const result = await packageBundle({
          bundleSlug: it.bundle_slug,
          bundleTitle: it.bundle_title,
          prints: prints.map<PrintInput>((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            sourcePath: p.source_path,
          })),
          outputDir: outDir,
        });

        db.prepare(
          `UPDATE entitlements SET package_path = ?, package_built_at = datetime('now')
           WHERE id = ?`,
        ).run(result.zipPath, ent.id);
      } catch (err) {
        // Don't poison the order on package failure — entitlement stays
        // un-built; ops can retry by re-firing the webhook or calling
        // a (future) /api/admin/retry-fulfillment endpoint.
        logger.error(
          { err, orderId: order.id, bundleId: it.bundle_id },
          'package build failed',
        );
        continue;
      }
    }

    const tokenId = newId();
    const { token, expiresAt } = issueToken(ent.id, tokenId);
    db.prepare(
      `INSERT INTO download_tokens (id, entitlement_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(tokenId, ent.id, expiresAt.toISOString());

    downloadUrls.push({
      bundleSlug: it.bundle_slug,
      url: `${config.publicBaseUrl}/api/downloads/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  }

  if (downloadUrls.length > 0) {
    db.prepare(
      `UPDATE orders SET status = 'fulfilled', fulfilled_at = datetime('now'),
                          updated_at = datetime('now')
       WHERE id = ? AND status = 'paid'`,
    ).run(order.id);
  }

  logger.info(
    { orderId: order.id, bundles: downloadUrls.length },
    'order fulfilled',
  );

  return { alreadyFulfilled: false, downloadUrls };
}

interface EntitlementRow {
  id: string;
  order_id: string;
  bundle_id: string;
  package_path: string | null;
  package_built_at: string | null;
  created_at: string;
}

function upsertEntitlement(orderId: string, bundleId: string): EntitlementRow {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, order_id, bundle_id, package_path, package_built_at, created_at
       FROM entitlements WHERE order_id = ? AND bundle_id = ?`,
    )
    .get(orderId, bundleId) as EntitlementRow | undefined;
  if (existing) return existing;

  const id = newId();
  db.prepare(
    `INSERT INTO entitlements (id, order_id, bundle_id) VALUES (?, ?, ?)`,
  ).run(id, orderId, bundleId);
  return {
    id,
    order_id: orderId,
    bundle_id: bundleId,
    package_path: null,
    package_built_at: null,
    created_at: new Date().toISOString(),
  };
}

function listDownloadUrlsForOrder(orderId: string): {
  bundleSlug: string;
  url: string;
  expiresAt: string;
}[] {
  // For re-issuance after fulfillment, mint a fresh token (old ones may be
  // expired). The actual package files are reused.
  const db = getDb();
  const ents = db
    .prepare(
      `SELECT e.id, e.bundle_id, b.slug AS bundle_slug
       FROM entitlements e JOIN bundles b ON b.id = e.bundle_id
       WHERE e.order_id = ? AND e.package_path IS NOT NULL`,
    )
    .all(orderId) as Array<{ id: string; bundle_id: string; bundle_slug: string }>;

  return ents.map((e) => {
    const tid = newId();
    const { token, expiresAt } = issueToken(e.id, tid);
    db.prepare(
      `INSERT INTO download_tokens (id, entitlement_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(tid, e.id, expiresAt.toISOString());
    return {
      bundleSlug: e.bundle_slug,
      url: `${config.publicBaseUrl}/api/downloads/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  });
}
