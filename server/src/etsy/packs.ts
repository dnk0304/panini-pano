import fs from 'node:fs';
import path from 'node:path';

/**
 * Themed pack definitions — Dennis-approved plan (2026-06-11 competitor scan):
 * 8 themed packs of 10-15 wallpaper files (2-3 prints x 5 ratios) + 1 mega
 * bundle. Themes inferred from print slugs in images/bundles/manifest.json.
 *
 * "File" = one ratio crop (2x3 / 3x4 / 4x5 / iso / master) of one print.
 */

export const RATIOS = ['2x3', '3x4', '4x5', 'iso', 'master'] as const;
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
  { slug: 'cosmos-celestial-charts', title: 'Celestial Charts', bundle: 'antique-cosmos', printNumbers: [1, 2, 3] },
  { slug: 'cosmos-constellations', title: 'Constellations & Zodiac', bundle: 'antique-cosmos', printNumbers: [5, 6, 7] },
  { slug: 'cosmos-instruments', title: 'Astronomical Instruments', bundle: 'antique-cosmos', printNumbers: [4, 10] },
  { slug: 'cosmos-night-sky', title: 'Comets & Lunar Plates', bundle: 'antique-cosmos', printNumbers: [8, 9] },
  { slug: 'kitchen-herbs', title: 'Kitchen Herbs', bundle: 'botanists-kitchen', printNumbers: [1, 2, 3] },
  { slug: 'kitchen-garden-aromatics', title: 'Garden Aromatics', bundle: 'botanists-kitchen', printNumbers: [4, 7, 11] },
  { slug: 'kitchen-orchard-fruits', title: 'Orchard & Fruits', bundle: 'botanists-kitchen', printNumbers: [5, 6, 12] },
  { slug: 'kitchen-pantry', title: 'Pantry Botanicals', bundle: 'botanists-kitchen', printNumbers: [8, 9, 10] },
  { slug: 'mega-bundle', title: 'Complete Collection (All 22 Prints)', bundle: 'all', printNumbers: [] },
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
        const all: Array<[Ratio, string]> = [
          ...Object.entries(print.crops).map(([r, rel]) => [r as Ratio, rel] as [Ratio, string]),
          ['master', print.master],
        ];
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
