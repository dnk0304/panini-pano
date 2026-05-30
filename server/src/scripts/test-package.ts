/**
 * Smoke test: build a packaged PDF from a real sample image so we can
 * verify the packager end-to-end without spinning up the full server.
 *
 *   npm run test:package
 *
 * Reads server/sample-art/test.jpg if present, otherwise generates a
 * synthetic 6000x8000 PNG on the fly using sharp.
 */
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { packageBundle } from '../services/pdf-packager';
import { PRINT_SIZES } from '../services/print-sizes';

async function main(): Promise<void> {
  const artDir = path.join(__dirname, '..', '..', 'sample-art');
  fs.mkdirSync(artDir, { recursive: true });
  const sampleJpg = path.join(artDir, 'test.jpg');

  if (!fs.existsSync(sampleJpg)) {
    // 6000x8000 synthetic test image — gradient + text would be nicer,
    // but a solid color is enough to prove the pipeline.
    await sharp({
      create: {
        width: 6000,
        height: 8000,
        channels: 3,
        background: { r: 200, g: 180, b: 140 }, // sepia
      },
    })
      .jpeg({ quality: 85 })
      .toFile(sampleJpg);
    // eslint-disable-next-line no-console
    console.log('generated synthetic sample at', sampleJpg);
  }

  const outDir = path.join(__dirname, '..', '..', 'data', 'test-package');
  fs.mkdirSync(outDir, { recursive: true });

  const result = await packageBundle({
    bundleSlug: 'test-bundle',
    bundleTitle: 'Test Bundle (packager smoke)',
    prints: [
      { id: 'p1', slug: 'sepia-i', title: 'Sepia I', sourcePath: sampleJpg },
    ],
    sizes: PRINT_SIZES,
    outputDir: outDir,
  });

  // eslint-disable-next-line no-console
  console.log('\nbuilt package:');
  // eslint-disable-next-line no-console
  console.log('  zip:        ', result.zipPath);
  // eslint-disable-next-line no-console
  console.log('  size:       ', `${(result.byteSize / 1024 / 1024).toFixed(2)} MB`);
  // eslint-disable-next-line no-console
  console.log('  pdfs built: ', result.pdfPaths.length);
  // eslint-disable-next-line no-console
  console.log('  pdfs:       ');
  for (const p of result.pdfPaths) {
    // eslint-disable-next-line no-console
    console.log('              ', p);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
