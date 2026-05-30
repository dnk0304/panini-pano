import { Router } from 'express';
import { getDb } from '../db';
import { asyncHandler, AppError, requireParam } from '../middleware/error';

export const bundlesRouter = Router();

interface BundleRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_image: string | null;
  price_cents: number;
  currency: string;
}

/**
 * GET /api/bundles
 * Public catalog (T7 hits this).
 */
bundlesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, slug, title, description, cover_image, price_cents, currency
         FROM bundles
         WHERE is_active = 1 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all() as BundleRow[];
    res.json(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description,
        coverImage: r.cover_image,
        priceCents: r.price_cents,
        currency: r.currency,
      })),
    );
  }),
);

/**
 * GET /api/bundles/:slug — bundle detail with print list.
 */
bundlesRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bundle = db
      .prepare(
        `SELECT id, slug, title, description, cover_image, price_cents, currency
         FROM bundles
         WHERE slug = ? AND is_active = 1 AND deleted_at IS NULL`,
      )
      .get(requireParam(req, 'slug')) as BundleRow | undefined;
    if (!bundle) throw new AppError(404, 'bundle_not_found', 'Bundle not found');

    const prints = db
      .prepare(
        `SELECT id, slug, title, sort_order
         FROM prints
         WHERE bundle_id = ? AND deleted_at IS NULL
         ORDER BY sort_order ASC`,
      )
      .all(bundle.id);

    res.json({
      id: bundle.id,
      slug: bundle.slug,
      title: bundle.title,
      description: bundle.description,
      coverImage: bundle.cover_image,
      priceCents: bundle.price_cents,
      currency: bundle.currency,
      prints,
    });
  }),
);
