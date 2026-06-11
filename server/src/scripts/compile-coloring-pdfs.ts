/**
 * Compile images/pdf-ready/<volume>/*.png into one PDF per volume
 * (digital-download coloring books). Pages are emitted at the image's
 * native pixel size mapped at 300 DPI, sorted by filename.
 *
 * Output: server/data/coloring-pdfs/<volume>.pdf + summary line per volume.
 * Pure local — no creds needed.
 *
 * Usage: npm run etsy:coloring-pdfs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const DPI = 300;
const siteRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(siteRoot, 'images', 'pdf-ready');
const outRoot = path.resolve(__dirname, '..', '..', 'data', 'coloring-pdfs');

async function compileVolume(volDir: string, outPath: string): Promise<{ pages: number; bytes: number }> {
  const images = fs.readdirSync(volDir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
  if (images.length === 0) return { pages: 0, bytes: 0 };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Panini Pano — ${path.basename(volDir)}`);
  pdf.setProducer('Panini Pano Packager');

  for (const name of images) {
    const full = path.join(volDir, name);
    // Re-encode to grayscale JPEG q85 — coloring pages are line art; this
    // keeps multi-hundred-page PDFs at a deliverable size with no visible loss.
    const img = sharp(full);
    const meta = await img.metadata();
    const jpeg = await img.grayscale().jpeg({ quality: 85 }).toBuffer();
    const embedded = await pdf.embedJpg(jpeg);
    const w = ((meta.width ?? 2550) / DPI) * 72;
    const h = ((meta.height ?? 3300) / DPI) * 72;
    const page = pdf.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }

  const bytes = await pdf.save();
  fs.writeFileSync(outPath, bytes);
  return { pages: images.length, bytes: bytes.length };
}

async function main(): Promise<void> {
  if (!fs.existsSync(srcRoot)) throw new Error(`Not found: ${srcRoot}`);
  fs.mkdirSync(outRoot, { recursive: true });

  const volumes = fs.readdirSync(srcRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let totalPages = 0;
  for (const vol of volumes) {
    const outPath = path.join(outRoot, `${vol}.pdf`);
    const { pages, bytes } = await compileVolume(path.join(srcRoot, vol), outPath);
    totalPages += pages;
    const flag = bytes > 20 * 1024 * 1024 ? '  [>20MB — needs ZIP-split or quality decision for Etsy]' : '';
    console.log(`${vol}: ${pages} pages, ${(bytes / 1e6).toFixed(1)}MB${flag}`);
  }
  console.log(`\n${volumes.length} volumes, ${totalPages} pages total -> ${outRoot}`);
}

void main().catch((err) => { console.error(err); process.exit(1); });
