import { getDb } from './index';
import { runMigrations } from './migrate';
import { newId } from '../lib/ids';
import { logger } from '../lib/logger';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config';

/**
 * Idempotent seeder for the REAL PaniniPano catalog.
 *
 * Source of truth: <staticRoot>/images/bundles/manifest.json — emitted by
 * the art pipeline. We read it on every run so adding/renaming prints
 * never requires touching this file.
 *
 * Marketing copy (title, tagline, price) is sourced from the static
 * bundle HTML pages (and verified against the data-bundle-price-cents
 * attributes those pages render). Kept inline here because the static
 * site is the customer-facing canon, not a runtime dependency of the
 * server.
 *
 * Safe to run on every boot:
 *   - INSERT ... ON CONFLICT(slug)/UNIQUE(bundle_id, slug) DO UPDATE
 *   - Wrapped in a single transaction
 *   - No destructive operations
 */

interface ManifestPrint {
  n: number;
  slug: string;
  latin: string;
  master: string; // path relative to images/bundles/
}

interface ManifestBundle {
  slug: string;
  name: string;
  count: number;
  prints: ManifestPrint[];
  cover: string; // path relative to images/bundles/
}

interface Manifest {
  generated_at: string;
  bundles: ManifestBundle[];
}

/**
 * Marketing overlay keyed by bundle slug. Values match the canonical
 * static HTML at bundles/<slug>.html (title + tagline + price-cents).
 */
const MARKETING: Record<
  string,
  { title: string; description: string; priceCents: number }
> = {
  'antique-cosmos': {
    title: 'Antique Cosmos',
    description:
      'Turn your bedroom into a vintage observatory — 10 antique celestial prints. Aged star maps, moon phases & copperplate planetary plates with dark-academia atmosphere.',
    priceCents: 1700,
  },
  'botanists-kitchen': {
    title: "The Botanist's Kitchen",
    description:
      'Fill your whole kitchen wall in one download — 12 cohesive antique herbarium plates on aged paper. Cottagecore warmth, framed today.',
    priceCents: 1900,
  },
};

/**
 * Resolve a print's display title from the manifest entry.
 * Prefers the Latin name (matches the static gallery captions);
 * falls back to a Title-Cased slug if latin is missing.
 */
function deriveTitle(p: ManifestPrint): string {
  if (p.latin && p.latin.trim()) return p.latin.trim();
  return p.slug
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function loadManifest(): Manifest {
  const manifestPath = path.join(config.staticRoot, 'images', 'bundles', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`bundle manifest not found at ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Manifest;
  if (!parsed.bundles || !Array.isArray(parsed.bundles)) {
    throw new Error(`bundle manifest at ${manifestPath} is malformed (no bundles[])`);
  }
  return parsed;
}

export function seed(): void {
  runMigrations();
  const db = getDb();

  const manifest = loadManifest();
  const bundlesRoot = path.join(config.staticRoot, 'images', 'bundles');

  const upsertBundle = db.prepare(`
    INSERT INTO bundles (id, slug, title, description, cover_image, price_cents, currency, is_active)
    VALUES (@id, @slug, @title, @description, @cover_image, @price_cents, @currency, 1)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      cover_image = excluded.cover_image,
      price_cents = excluded.price_cents,
      currency = excluded.currency,
      is_active = 1,
      updated_at = datetime('now')
    RETURNING id
  `);

  const upsertPrint = db.prepare(`
    INSERT INTO prints (id, bundle_id, slug, title, source_path, source_width_px, source_height_px, sort_order)
    VALUES (@id, @bundle_id, @slug, @title, @source_path, @source_width_px, @source_height_px, @sort_order)
    ON CONFLICT(bundle_id, slug) DO UPDATE SET
      title = excluded.title,
      source_path = excluded.source_path,
      sort_order = excluded.sort_order,
      updated_at = datetime('now')
  `);

  let bundlesSeeded = 0;
  let printsSeeded = 0;
  let printsMissingMaster = 0;

  const tx = db.transaction(() => {
    for (const mb of manifest.bundles) {
      const marketing = MARKETING[mb.slug];
      if (!marketing) {
        logger.warn(
          { slug: mb.slug },
          'manifest bundle has no marketing overlay — skipping',
        );
        continue;
      }

      const row = upsertBundle.get({
        id: newId(),
        slug: mb.slug,
        title: marketing.title,
        description: marketing.description,
        // Relative-under-STATIC_ROOT, per schema.sql convention.
        cover_image: `images/bundles/${mb.cover}`,
        price_cents: marketing.priceCents,
        currency: 'USD',
      }) as { id: string };

      // Sort prints by manifest `n` so order is deterministic regardless
      // of JSON key order.
      const orderedPrints = [...mb.prints].sort((a, b) => a.n - b.n);

      for (const p of orderedPrints) {
        const sourcePath = path.join(bundlesRoot, p.master);
        if (!fs.existsSync(sourcePath)) {
          // Don't crash — log + skip dimension hardening. Packager fails
          // loudly later if a master is genuinely missing.
          printsMissingMaster++;
          logger.warn(
            { bundle: mb.slug, print: p.slug, sourcePath },
            'master image missing on disk at seed time',
          );
        }

        upsertPrint.run({
          id: newId(),
          bundle_id: row.id,
          slug: p.slug,
          title: deriveTitle(p),
          source_path: sourcePath,
          // Real dimensions live in the master file; packager reads them
          // via sharp. We store conservative defaults so legacy queries
          // that read these columns don't trip.
          source_width_px: 6000,
          source_height_px: 8000,
          sort_order: p.n,
        });
        printsSeeded++;
      }
      bundlesSeeded++;
    }
  });
  tx();

  logger.info(
    {
      bundles: bundlesSeeded,
      prints: printsSeeded,
      printsMissingMaster,
      manifestGeneratedAt: manifest.generated_at,
      dataDir: config.dataDir,
    },
    'seed complete',
  );
}

if (require.main === module) {
  seed();
  process.exit(0);
}
