import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { newId } from '../lib/ids';
import { AppError, asyncHandler, requireParam } from '../middleware/error';

/**
 * Cart routes. Server-side state, cookie-bound id.
 *
 *   POST   /api/cart                       create a new cart
 *   GET    /api/cart/:id                   read cart + items + total
 *   POST   /api/cart/:id/items             add a bundle (or bump qty)
 *   DELETE /api/cart/:id/items/:itemId     remove an item
 *
 *   POST   /api/cart/:id/checkout          locks cart → creates order in 'pending'
 *                                           (Whop session URL appended by /api/checkout/whop)
 *
 * Carts are NOT user-bound (no auth). The cookie `pp_cart_id` lets the
 * browser pick up its cart on return; lost cookies just abandon the cart.
 */
export const cartRouter = Router();

const CART_COOKIE = 'pp_cart_id';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CartRow {
  id: string;
  status: 'open' | 'checked_out' | 'abandoned';
  checked_out_order_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CartItemRow {
  id: string;
  cart_id: string;
  bundle_id: string;
  quantity: number;
  unit_price_cents: number;
  currency: string;
  // joined from bundles for convenience:
  bundle_slug?: string;
  bundle_title?: string;
}

function setCartCookie(res: Response, cartId: string): void {
  res.cookie(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function loadCart(id: string): CartRow {
  const db = getDb();
  const row = db
    .prepare('SELECT id, status, checked_out_order_id, created_at, updated_at FROM carts WHERE id = ?')
    .get(id) as CartRow | undefined;
  if (!row) throw new AppError(404, 'cart_not_found', `Cart ${id} not found`);
  return row;
}

function loadCartItems(cartId: string): CartItemRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT ci.id, ci.cart_id, ci.bundle_id, ci.quantity, ci.unit_price_cents, ci.currency,
              b.slug AS bundle_slug, b.title AS bundle_title
       FROM cart_items ci
       JOIN bundles b ON b.id = ci.bundle_id
       WHERE ci.cart_id = ?
       ORDER BY ci.created_at ASC`,
    )
    .all(cartId) as CartItemRow[];
}

function serializeCart(cart: CartRow, items: CartItemRow[]) {
  const totalCents = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
  return {
    id: cart.id,
    status: cart.status,
    items: items.map((i) => ({
      id: i.id,
      bundleId: i.bundle_id,
      bundleSlug: i.bundle_slug,
      bundleTitle: i.bundle_title,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
      currency: i.currency,
    })),
    totalCents,
    currency: items[0]?.currency ?? 'USD',
    checkedOutOrderId: cart.checked_out_order_id,
    createdAt: cart.created_at,
    updatedAt: cart.updated_at,
  };
}

// -------------------------------------------------------------------------
// POST /api/cart — create
// -------------------------------------------------------------------------
cartRouter.post(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const id = newId();
    getDb().prepare('INSERT INTO carts (id) VALUES (?)').run(id);
    setCartCookie(res, id);
    res.status(201).json({ id, status: 'open', items: [], totalCents: 0, currency: 'USD' });
  }),
);

// -------------------------------------------------------------------------
// GET /api/cart/:id
// -------------------------------------------------------------------------
cartRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const cart = loadCart(requireParam(req, 'id'));
    const items = loadCartItems(cart.id);
    res.json(serializeCart(cart, items));
  }),
);

// -------------------------------------------------------------------------
// POST /api/cart/:id/items — add (or bump qty)
// -------------------------------------------------------------------------
const addItemSchema = z.object({
  bundleId: z.string().uuid().optional(),
  bundleSlug: z.string().min(1).optional(),
  quantity: z.number().int().positive().max(99).default(1),
}).refine((d) => d.bundleId ?? d.bundleSlug, {
  message: 'bundleId or bundleSlug required',
});

cartRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const cart = loadCart(requireParam(req, 'id'));
    if (cart.status !== 'open') {
      throw new AppError(409, 'cart_locked', 'Cart is no longer modifiable');
    }
    const body = addItemSchema.parse(req.body);
    const db = getDb();

    const bundle = (
      body.bundleId
        ? db
            .prepare(
              `SELECT id, price_cents, currency FROM bundles
               WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
            )
            .get(body.bundleId)
        : db
            .prepare(
              `SELECT id, price_cents, currency FROM bundles
               WHERE slug = ? AND is_active = 1 AND deleted_at IS NULL`,
            )
            .get(body.bundleSlug)
    ) as { id: string; price_cents: number; currency: string } | undefined;

    if (!bundle) throw new AppError(404, 'bundle_not_found', 'Bundle not found');

    // UPSERT semantics — bump quantity if already present.
    db.prepare(
      `INSERT INTO cart_items (id, cart_id, bundle_id, quantity, unit_price_cents, currency)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cart_id, bundle_id) DO UPDATE SET
         quantity = quantity + excluded.quantity`,
    ).run(newId(), cart.id, bundle.id, body.quantity, bundle.price_cents, bundle.currency);

    db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(cart.id);

    const items = loadCartItems(cart.id);
    res.status(200).json(serializeCart(loadCart(cart.id), items));
  }),
);

// -------------------------------------------------------------------------
// DELETE /api/cart/:id/items/:itemId
// -------------------------------------------------------------------------
cartRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const cart = loadCart(requireParam(req, 'id'));
    if (cart.status !== 'open') {
      throw new AppError(409, 'cart_locked', 'Cart is no longer modifiable');
    }
    const db = getDb();
    const result = db
      .prepare('DELETE FROM cart_items WHERE id = ? AND cart_id = ?')
      .run(requireParam(req, 'itemId'), cart.id);
    if (result.changes === 0) {
      throw new AppError(404, 'item_not_found', 'Cart item not found');
    }
    db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(cart.id);
    res.json(serializeCart(loadCart(cart.id), loadCartItems(cart.id)));
  }),
);

// -------------------------------------------------------------------------
// POST /api/cart/:id/checkout — lock cart, create pending order
// (Whop session URL is appended by /api/checkout/whop. Decoupled so the
// caller can choose the rail later: Stripe, manual, etc.)
// -------------------------------------------------------------------------
const checkoutSchema = z.object({
  email: z.string().email().optional(),
});

cartRouter.post(
  '/:id/checkout',
  asyncHandler(async (req, res) => {
    const cart = loadCart(requireParam(req, 'id'));
    if (cart.status !== 'open') {
      throw new AppError(409, 'cart_locked', 'Cart is no longer modifiable');
    }
    const body = checkoutSchema.parse(req.body ?? {});
    const items = loadCartItems(cart.id);
    if (items.length === 0) {
      throw new AppError(400, 'cart_empty', 'Cart has no items');
    }

    const db = getDb();
    const orderId = newId();
    const totalCents = items.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
    const currency = items[0]?.currency ?? 'USD';

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO orders (id, cart_id, customer_email, status, total_cents, currency)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      ).run(orderId, cart.id, body.email ?? null, totalCents, currency);

      for (const i of items) {
        db.prepare(
          `INSERT INTO order_items (id, order_id, bundle_id, quantity, unit_price_cents, currency)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(newId(), orderId, i.bundle_id, i.quantity, i.unit_price_cents, i.currency);
      }

      db.prepare(
        `UPDATE carts SET status = 'checked_out', checked_out_order_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(orderId, cart.id);
    });
    tx();

    res.status(201).json({
      orderId,
      status: 'pending',
      totalCents,
      currency,
      // Next step for the client: POST /api/checkout/whop { orderId } → redirect URL.
      nextStep: { method: 'POST', url: '/api/checkout/whop', body: { orderId } },
    });
  }),
);
