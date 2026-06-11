import fs from 'node:fs';
import path from 'node:path';

/**
 * Pack definitions — aligned 1:1 with Marketing's etsy-listings-copy.json
 * (2026-06-11, WALL-ART ONLY scope: coloring books are off Etsy). Slugs ==
 * copy `id`s. Copy promises "4 frame-ready ratios per print" so master
 * crops are NOT delivered (they're huge and unadvertised).
 *
 * "File" = one ratio crop (2x3 / 3x4 / 4x5 / iso) of one print.
 */

export const RATIOS = ['2x3', '3x4', '4x5', 'iso'] as const;
export type Ratio = (typeof RATIOS)[number];

export interface PackDef {
  slug: string;
  title: string;
  /** Source bundle slug under images/bundles/. */
  bundle: 'antique-cosmos' | 'botanists-kitchen' | 'all';
  /** Print numbers (the NN- filename prefix) included. Empty = all prints. */
  printNumbers: number[];
}

export const PACKS: PackDef[] = [
  { slug: 'antique-cosmos-full', title: 'Vintage Celestial Set of 10', bundle: 'antique-cosmos', printNumbers: [] },
  { slug: 'antique-cosmos-starmaps', title: 'Star Map Set of 5', bundle: 'antique-cosmos', printNumbers: [2, 5, 6, 7, 10] },
  { slug: 'antique-cosmos-moonsun', title: 'Moon & Sun Set of 5', bundle: 'antique-cosmos', printNumbers: [1, 3, 4, 8, 9] },
  { slug: 'botanists-kitchen-full', title: 'Botanical Kitchen Set of 12', bundle: 'botanists-kitchen', printNumbers: [] },
  { slug: 'botanists-kitchen-herbs', title: 'Herb Set of 5', bundle: 'botanists-kitchen', printNumbers: [1, 2, 3, 4, 11] },
  { slug: 'botanists-kitchen-garden', title: 'Garden & Orchard Set of 7', bundle: 'botanists-kitchen', printNumbers: [5, 6, 7, 8, 9, 10, 12] },
  { slug: 'heritage-mega-bundle', title: 'Heritage Mega Bundle (All 22 Prints)', bundle: 'all', printNumbers: [] },
];

interface BundleManifest {
  bundles: Array<{
    slug: string;
    name: string;
    prints: Array<{ n: number; slug: string; master: string; crops: Record<string, string> }>;
  }>;
}

export interface PackFile {
  /** Absolute source path. */
  src: string;
  /** Name inside the delivered zip, e.g. "celestial-charts/moon-phase-chart-2x3.jpg". */
  zipName: string;
}

export interface ResolvedPack {
  def: PackDef;
  files: PackFile[];
  /** Cover image candidates for the listing (bundle cover + first print 4x5). */
  imageCandidates: string[];
}

export function resolvePacks(siteRoot: string): ResolvedPack[] {
  const bundlesDir = path.join(siteRoot, 'images', 'bundles');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundlesDir, 'manifest.json'), 'utf8'),
  ) as BundleManifest;

  const byBundle = new Map(manifest.bundles.map((b) => [b.slug, b]));

  return PACKS.map((def) => {
    const sources =
      def.bundle === 'all'
        ? [...byBundle.values()]
        : [byBundle.get(def.bundle) ?? fail(`bundle not in manifest: ${def.bundle}`)];

    const files: PackFile[] = [];
    const imageCandidates: string[] = [];

    for (const bundle of sources) {
      const cover = path.join(bundlesDir, bundle.slug, 'cover.png');
      if (fs.existsSync(cover)) imageCandidates.push(cover);

      const prints =
        def.printNumbers.length === 0
          ? bundle.prints
          : bundle.prints.filter((p) => def.printNumbers.includes(p.n));

      if (def.printNumbers.length > 0 && prints.length !== def.printNumbers.length) {
        fail(`pack ${def.slug}: wanted prints ${def.printNumbers.join(',')} but found ${prints.length}`);
      }

      for (const print of prints) {
        // Deliver only the advertised ratio crops — master is intentionally excluded.
        const all: Array<[Ratio, string]> = Object.entries(print.crops)
          .filter(([r]) => (RATIOS as readonly string[]).includes(r))
          .map(([r, rel]) => [r as Ratio, rel] as [Ratio, string]);
        if (all.length !== RATIOS.length) {
          fail(`print ${print.slug}: expected ratios ${RATIOS.join(',')} in manifest crops, got ${Object.keys(print.crops).join(',')}`);
        }
        for (const [ratio, rel] of all) {
          const src = path.join(bundlesDir, rel);
          if (!fs.existsSync(src)) fail(`missing source file: ${src}`);
          files.push({ src, zipName: `${print.slug}-${ratio}.jpg` });
        }
        imageCandidates.push(path.join(bundlesDir, bundle.slug, 'prints', `${String(print.n).padStart(2, '0')}-${print.slug}-4x5.png`));
      }
    }
    return { def, files, imageCandidates };
  });
}

function fail(msg: string): never {
  throw new Error(`[packs] ${msg}`);
}
