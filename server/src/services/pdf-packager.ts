import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import archiver from 'archiver';
import { PRINT_SIZES, DPI, inchesToPixels, inchesToPoints, type PrintSize } from './print-sizes';
import { logger } from '../lib/logger';

/**
 * Input shape for the packager. Decoupled from the DB rows so this can
 * be unit-tested with raw paths.
 */
export interface PrintInput {
  /** Internal id (kept for diagnostics). */
  id: string;
  /** Slug used in filenames (e.g. 'fern-i'). */
  slug: string;
  /** Display title (PDF metadata). */
  title: string;
  /** Absolute path to the highest-res master image. PNG/JPG/WebP/TIFF all OK via sharp. */
  sourcePath: string;
}

export interface PackageOptions {
  /** Bundle identifier (used for filenames). */
  bundleSlug: string;
  /** Display title (PDF metadata). */
  bundleTitle: string;
  /** Prints to package. */
  prints: ReadonlyArray<PrintInput>;
  /** Sizes to render. Defaults to the full PRINT_SIZES catalogue. */
  sizes?: ReadonlyArray<PrintSize>;
  /** Destination directory for the zip + intermediates. */
  outputDir: string;
}

export interface PackageResult {
  zipPath: string;
  pdfPaths: string[];
  byteSize: number;
  builtAt: string;
}

/**
 * Build a multi-size PDF package for a bundle.
 *
 * Layout in the zip:
 *   <bundle-slug>/
 *     A4/
 *       <print-slug>.pdf
 *     A3/
 *       <print-slug>.pdf
 *     ...
 *     README.txt
 *
 * Each PDF is a single page at the exact physical dimensions of the size.
 * The bitmap is embedded at 300 DPI (sharp resizes the master to the
 * required pixel count using cover-fit + center crop — keeps the print
 * filling the frame; trims minimal edge to fit the aspect ratio).
 */
export async function packageBundle(opts: PackageOptions): Promise<PackageResult> {
  const sizes = opts.sizes ?? PRINT_SIZES;
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const pdfPaths: string[] = [];

  for (const print of opts.prints) {
    if (!fs.existsSync(print.sourcePath)) {
      throw new Error(
        `[packager] missing source for print "${print.slug}": ${print.sourcePath}`,
      );
    }

    // Inspect the source so we can fail loudly on too-small masters.
    let srcMeta: sharp.Metadata;
    try {
      srcMeta = await sharp(print.sourcePath).metadata();
    } catch (err) {
      throw new Error(
        `[packager] failed to read source "${print.slug}" (${print.sourcePath}): ` +
          `${(err as Error).message}. Placeholder .txt files are not valid images — ` +
          `replace with real PNG/JPG masters before packaging.`,
      );
    }
    const srcW = srcMeta.width ?? 0;
    const srcH = srcMeta.height ?? 0;

    for (const size of sizes) {
      const targetPxW = inchesToPixels(size.widthIn, DPI);
      const targetPxH = inchesToPixels(size.heightIn, DPI);

      // Warn (but don't fail) if the master is too small for this print size.
      // Print quality degrades below 300 DPI; we still produce the file so
      // T7 can show it, but a real launch needs higher-res masters.
      if (srcW < targetPxW || srcH < targetPxH) {
        logger.warn(
          {
            print: print.slug,
            size: size.id,
            srcW,
            srcH,
            needW: targetPxW,
            needH: targetPxH,
          },
          'master smaller than target — output will be upscaled (sub-300 DPI)',
        );
      }

      // Resize the master to the exact target pixel count.
      // cover-fit + center crop preserves aspect for the print frame.
      // Output PNG (lossless) so the embedded bitmap is sharp.
      const bitmap = await sharp(print.sourcePath)
        .resize(targetPxW, targetPxH, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9 })
        .toBuffer();

      const pdf = await PDFDocument.create();
      pdf.setTitle(`${opts.bundleTitle} — ${print.title} (${size.label})`);
      pdf.setSubject('Panini Pano printable wall art');
      pdf.setProducer('Panini Pano Packager');
      pdf.setCreator('Panini Pano');

      const img = await pdf.embedPng(bitmap);
      const pageW = inchesToPoints(size.widthIn);
      const pageH = inchesToPoints(size.heightIn);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });

      const sizeDir = path.join(opts.outputDir, size.id);
      fs.mkdirSync(sizeDir, { recursive: true });
      const pdfPath = path.join(sizeDir, `${print.slug}.pdf`);
      const bytes = await pdf.save();
      fs.writeFileSync(pdfPath, bytes);
      pdfPaths.push(pdfPath);
    }
  }

  // README in the package so the buyer understands the file layout.
  const readmePath = path.join(opts.outputDir, 'README.txt');
  fs.writeFileSync(
    readmePath,
    [
      `Panini Pano — ${opts.bundleTitle}`,
      ``,
      `This package contains ${opts.prints.length} prints, each provided in`,
      `${sizes.length} print sizes at 300 DPI for high-quality printing.`,
      ``,
      `Folder structure:`,
      ...sizes.map((s) => `  ${s.id}/  →  ${s.label}`),
      ``,
      `For best results, print on heavy matte or fine-art paper.`,
      ``,
      `Thank you for buying from Panini Pano.`,
      `https://panini-pano.com`,
      ``,
    ].join('\n'),
  );

  // Zip the whole thing.
  const zipPath = path.join(opts.outputDir, `${opts.bundleSlug}.zip`);
  await zipDirectory(opts.outputDir, zipPath, opts.bundleSlug);

  const byteSize = fs.statSync(zipPath).size;

  logger.info(
    { bundleSlug: opts.bundleSlug, prints: opts.prints.length, sizes: sizes.length, byteSize },
    'package built',
  );

  return {
    zipPath,
    pdfPaths,
    byteSize,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Zip a directory into a single file. Only includes the per-size dirs and
 * the README — skips the resulting zip itself if it already exists in dir.
 */
function zipDirectory(srcDir: string, zipPath: string, rootName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // If a previous zip is in srcDir, ensure we don't recurse it.
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);

    // Walk srcDir manually so we can give entries a `rootName/` prefix
    // and skip the zip file itself.
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const entryName = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, entryName);
        } else {
          if (path.resolve(full) === path.resolve(zipPath)) continue;
          archive.file(full, { name: `${rootName}/${entryName}` });
        }
      }
    };
    walk(srcDir, '');

    archive.finalize().catch(reject);
  });
}
