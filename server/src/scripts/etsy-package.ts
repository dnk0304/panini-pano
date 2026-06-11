/**
 * Packaging: themed packs -> Etsy-deliverable ZIP parts.
 *
 * Etsy digital-download limits: max 5 files per listing, 20MB each.
 * Source crops are 8-35MB PNGs (incompressible in ZIP), so each image is
 * transcoded to full-resolution JPEG quality 90 (Etsy-standard wall-art
 * delivery) before zipping. ZIPs are split greedily into parts <= 19MB
 * (1MB safety margin); any pack needing >5 parts is FLAGGED, not truncated.
 *
 * Output: server/data/etsy-packages/<pack>/<pack>-part1.zip ... +
 *         server/data/etsy-packages/packages-manifest.json
 *
 * Usage: npm run etsy:package   (no creds needed — pure local)
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import archiver from 'archiver';
import { resolvePacks, type PackFile } from '../etsy/packs';

const JPEG_QUALITY = 90;
const PART_LIMIT = 19 * 1024 * 1024; // 19MB safety margin under Etsy's 20MB
const MAX_PARTS = 5;

const siteRoot = path.resolve(__dirname, '..', '..', '..');
const outRoot = path.resolve(__dirname, '..', '..', 'data', 'etsy-packages');
const jpegCache = path.join(outRoot, '_jpeg-cache');

interface PartResult { file: string; bytes: number; entries: number }
interface PackResult {
  slug: string;
  title: string;
  files: number;
  parts: PartResult[];
  withinEtsyLimits: boolean;
  imageCandidates: string[];
}

async function toJpeg(file: PackFile): Promise<{ jpegPath: string; bytes: number }> {
  const hashName = file.zipName.replace(/[\\/]/g, '_');
  const jpegPath = path.join(jpegCache, hashName);
  if (!fs.existsSync(jpegPath)) {
    await sharp(file.src).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(jpegPath);
  }
  return { jpegPath, bytes: fs.statSync(jpegPath).size };
}

function writeZip(zipPath: string, entries: Array<{ src: string; name: string }>): Promise<number> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    // level 0: JPEGs don't compress; store-only is faster and predictable.
    const archive = archiver('zip', { zlib: { level: 0 } });
    out.on('close', () => resolve(fs.statSync(zipPath).size));
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    for (const e of entries) archive.file(e.src, { name: e.name });
    archive.finalize().catch(reject);
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(jpegCache, { recursive: true });
  const packs = resolvePacks(siteRoot);
  const results: PackResult[] = [];

  for (const pack of packs) {
    const packDir = path.join(outRoot, pack.def.slug);
    fs.mkdirSync(packDir, { recursive: true });

    // Transcode all sources first so we can bin-pack by real size.
    const items: Array<{ jpegPath: string; name: string; bytes: number }> = [];
    for (const f of pack.files) {
      const { jpegPath, bytes } = await toJpeg(f);
      if (bytes > PART_LIMIT) {
        console.warn(`  WARN ${f.zipName}: ${(bytes / 1e6).toFixed(1)}MB exceeds a whole part even as JPEG`);
      }
      items.push({ jpegPath, name: f.zipName, bytes });
    }

    // Greedy first-fit-decreasing bin packing into <=19MB zip parts.
    items.sort((a, b) => b.bytes - a.bytes);
    const bins: Array<{ entries: typeof items; bytes: number }> = [];
    for (const item of items) {
      const bin = bins.find((b) => b.bytes + item.bytes <= PART_LIMIT);
      if (bin) { bin.entries.push(item); bin.bytes += item.bytes; }
      else bins.push({ entries: [item], bytes: item.bytes });
    }

    const parts: PartResult[] = [];
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i]!;
      const zipPath = path.join(packDir, `panini-pano-${pack.def.slug}-part${i + 1}-of-${bins.length}.zip`);
      const bytes = await writeZip(zipPath, bin.entries.map((e) => ({ src: e.jpegPath, name: e.name })));
      parts.push({ file: zipPath, bytes, entries: bin.entries.length });
    }

    const ok = parts.length <= MAX_PARTS && parts.every((p) => p.bytes <= 20 * 1024 * 1024);
    results.push({
      slug: pack.def.slug,
      title: pack.def.title,
      files: pack.files.length,
      parts,
      withinEtsyLimits: ok,
      imageCandidates: pack.imageCandidates.filter((p) => fs.existsSync(p)),
    });
    console.log(
      `${ok ? 'OK   ' : 'FLAG '}${pack.def.slug}: ${pack.files.length} files -> ${parts.length} part(s), ` +
        parts.map((p) => `${(p.bytes / 1e6).toFixed(1)}MB`).join(' + '),
    );
  }

  const manifestPath = path.join(outRoot, 'packages-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ generated_at: new Date().toISOString(), jpegQuality: JPEG_QUALITY, packs: results }, null, 2));
  console.log(`\nManifest: ${manifestPath}`);

  const flagged = results.filter((r) => !r.withinEtsyLimits);
  if (flagged.length > 0) {
    console.log(`\nFLAGGED (exceed 5x20MB native delivery): ${flagged.map((f) => `${f.slug} (${f.parts.length} parts)`).join(', ')}`);
    console.log('Decision needed: lower JPEG quality, drop a ratio, or split into multiple listings.');
  }
}

void main().catch((err) => { console.error(err); process.exit(1); });
