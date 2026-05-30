import { getDb } from './index';
import { runMigrations } from './migrate';
import { newId } from '../lib/ids';
import { logger } from '../lib/logger';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config';

/**
 * Idempotent seeder. Inserts two placeholder bundles + a handful of prints.
 *
 * SHAPE-FROZEN for T11: when T8 produces real vintage art, T11 swaps
 * `sample-art/*.jpg` references for real generated PNGs but keeps the
 * same `bundles` + `prints` schema. T2 marketing copy plugs into title/
 * description fields.
 */
function seed(): void {
  runMigrations();
  const db = getDb();

  const sampleArtDir = path.join(__dirname, '..', '..', 'sample-art');
  fs.mkdirSync(sampleArtDir, { recursive: true });

  // Generate trivial placeholder JPGs if missing so packaging tests work
  // out of the box. Real art replaces these at T11.
  const placeholderPaths = [
    path.join(sampleArtDir, 'placeholder-1.txt'),
    path.join(sampleArtDir, 'placeholder-2.txt'),
    path.join(sampleArtDir, 'placeholder-3.txt'),
  ];
  for (const p of placeholderPaths) {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(
        p,
        'Replace this file with a 300+ DPI master image (PNG or JPG). ' +
          'See server/src/services/pdf-packager.ts for sizing rules.\n',
      );
    }
  }

  const upsertBundle = db.prepare(`
    INSERT INTO bundles (id, slug, title, description, cover_image, price_cents, currency, is_active)
    VALUES (@id, @slug, @title, @description, @cover_image, @price_cents, @currency, 1)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      price_cents = excluded.price_cents,
      updated_at = datetime('now')
    RETURNING id
  `);

  const upsertPrint = db.prepare(`
    INSERT INTO prints (id, bundle_id, slug, title, source_path, source_width_px, source_height_px, sort_order)
    VALUES (@id, @bundle_id, @slug, @title, @source_path, @source_width_px, @source_height_px, @sort_order)
    ON CONFLICT(bundle_id, slug) DO UPDATE SET
      title = excluded.title,
      source_path = excluded.source_path,
      updated_at = datetime('now')
  `);

  const placeholderBundles: Array<{
    slug: string;
    title: string;
    description: string;
    cover_image: string | null;
    price_cents: number;
    prints: Array<{ slug: string; title: string; source_path: string }>;
  }> = [
    {
      slug: 'vintage-botanicals',
      title: '[PLACEHOLDER] Vintage Botanicals',
      description:
        'Placeholder bundle — real T2 copy + T8 art replaces this at T11. 12 prints, each delivered at 6 print sizes (A4, A3, US Letter, 12x16, 16x20, 18x24).',
      cover_image: null,
      price_cents: 1900,
      prints: [
        { slug: 'fern-i', title: 'Fern I', source_path: path.join(sampleArtDir, 'placeholder-1.txt') },
        { slug: 'fern-ii', title: 'Fern II', source_path: path.join(sampleArtDir, 'placeholder-2.txt') },
        { slug: 'fern-iii', title: 'Fern III', source_path: path.join(sampleArtDir, 'placeholder-3.txt') },
      ],
    },
    {
      slug: 'fading-films',
      title: '[PLACEHOLDER] Fading Films',
      description:
        'Placeholder bundle — real T2 copy + T8 art replaces this at T11. 12 prints, each delivered at 6 print sizes.',
      cover_image: null,
      price_cents: 2400,
      prints: [
        { slug: 'cinema-i', title: 'Cinema I', source_path: path.join(sampleArtDir, 'placeholder-1.txt') },
        { slug: 'cinema-ii', title: 'Cinema II', source_path: path.join(sampleArtDir, 'placeholder-2.txt') },
      ],
    },
  ];

  const tx = db.transaction(() => {
    for (const b of placeholderBundles) {
      const bundleId = newId();
      const row = upsertBundle.get({
        id: bundleId,
        slug: b.slug,
        title: b.title,
        description: b.description,
        cover_image: b.cover_image,
        price_cents: b.price_cents,
        currency: 'USD',
      }) as { id: string };

      let sortOrder = 0;
      for (const p of b.prints) {
        upsertPrint.run({
          id: newId(),
          bundle_id: row.id,
          slug: p.slug,
          title: p.title,
          source_path: p.source_path,
          // Placeholder dims — real masters will populate these accurately.
          source_width_px: 6000,
          source_height_px: 8000,
          sort_order: sortOrder++,
        });
      }
    }
  });
  tx();

  logger.info(
    { bundles: placeholderBundles.length, dataDir: config.dataDir },
    'seed complete',
  );
}

if (require.main === module) {
  seed();
  process.exit(0);
}
