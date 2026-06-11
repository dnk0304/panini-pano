/**
 * Batch push: create DRAFT listings on Etsy from Marketing's copy file +
 * the packaging manifest. Never publishes (see publishListing gate).
 *
 * Inputs:
 *   1. <site-root>/etsy-listings-copy.json  (Marketing) — per pack slug:
 *      { "<slug>": { title, description, tags[<=13], price } }
 *      Accepts either a flat object keyed by slug or { listings: [...] } with
 *      a slug field per entry.
 *   2. server/data/etsy-packages/packages-manifest.json (npm run etsy:package)
 *
 * Modes:
 *   npm run etsy:push                  -> dry-run: validate everything, report plan + gaps
 *   npm run etsy:push -- --live        -> create/update drafts + upload assets (needs OAuth tokens)
 *   npm run etsy:push -- --placeholder -> create ONE test draft ("PLACEHOLDER - do not publish")
 *                                         to prove the pipeline before the copy file lands
 *
 * Idempotent: data/etsy-listings.json (slug -> listing_id) — re-runs update,
 * skip already-uploaded assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getMe } from '../etsy/client';
import {
  createDraftListing, updateListing, uploadListingFile, uploadListingImage,
  uploadListingVideo, resolveTaxonomyId, loadListingMap, saveListingMap,
} from '../etsy/listings';

const siteRoot = path.resolve(__dirname, '..', '..', '..');
const copyPath = process.env.ETSY_COPY_PATH ?? path.join(siteRoot, 'etsy-listings-copy.json');
const manifestPath = path.resolve(__dirname, '..', '..', 'data', 'etsy-packages', 'packages-manifest.json');

interface CopyEntry { slug?: string; title: string; description: string; tags: string[]; price: number }
interface PackEntry {
  slug: string; title: string; files: number;
  parts: Array<{ file: string; bytes: number }>;
  withinEtsyLimits: boolean; imageCandidates: string[];
}

const VIDEO_BY_BUNDLE: Record<string, string> = {
  cosmos: path.join(siteRoot, 'videos', 'promo', 'clips', 'antique-cosmos-veo__a1.mp4'),
  kitchen: path.join(siteRoot, 'videos', 'promo', 'clips', 'botanists-kitchen-veo__b1.mp4'),
  mega: path.join(siteRoot, 'videos', 'promo', 'antique-cosmos-veo.mp4'),
};

function videoForPack(slug: string): string | undefined {
  const key = slug.startsWith('cosmos') ? 'cosmos' : slug.startsWith('kitchen') ? 'kitchen' : 'mega';
  const p = VIDEO_BY_BUNDLE[key];
  return p && fs.existsSync(p) ? p : undefined;
}

function loadCopy(): Map<string, CopyEntry> | null {
  if (!fs.existsSync(copyPath)) return null;
  const raw = JSON.parse(fs.readFileSync(copyPath, 'utf8')) as unknown;
  const map = new Map<string, CopyEntry>();
  if (Array.isArray((raw as { listings?: unknown }).listings)) {
    for (const e of (raw as { listings: CopyEntry[] }).listings) {
      if (e.slug) map.set(e.slug, e);
    }
  } else {
    for (const [slug, e] of Object.entries(raw as Record<string, CopyEntry>)) map.set(slug, e);
  }
  return map;
}

function validateEntry(slug: string, e: CopyEntry | undefined): string[] {
  const gaps: string[] = [];
  if (!e) return [`${slug}: NO COPY — Marketing must add this slug`];
  if (!e.title || e.title.length > 140) gaps.push(`${slug}: title missing or >140 chars`);
  if (!e.description) gaps.push(`${slug}: description missing`);
  if (!Array.isArray(e.tags) || e.tags.length === 0 || e.tags.length > 13) gaps.push(`${slug}: needs 1-13 tags (has ${e.tags?.length ?? 0})`);
  if (typeof e.price !== 'number' || e.price < 0.2) gaps.push(`${slug}: invalid price`);
  return gaps;
}

async function pushOne(shopId: number, taxonomyId: number, slug: string, copy: CopyEntry, pack: PackEntry): Promise<void> {
  const map = loadListingMap();
  let rec = map[slug];

  if (!rec) {
    const { listing_id } = await createDraftListing(shopId, {
      title: copy.title, description: copy.description, tags: copy.tags,
      price: copy.price, taxonomy_id: taxonomyId,
    });
    rec = { listing_id, created_at: new Date().toISOString(), images_uploaded: [], files_uploaded: [] };
    map[slug] = rec; saveListingMap(map);
    console.log(`  created draft ${listing_id}`);
  } else {
    await updateListing(shopId, rec.listing_id, {
      title: copy.title, description: copy.description, tags: copy.tags, price: copy.price,
    });
    console.log(`  updated draft ${rec.listing_id}`);
  }

  const images = pack.imageCandidates.slice(0, 10);
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    if (rec.images_uploaded.includes(img)) continue;
    await uploadListingImage(shopId, rec.listing_id, img, i + 1);
    rec.images_uploaded.push(img); saveListingMap(map);
    console.log(`  image ${i + 1}/${images.length}`);
  }

  for (let i = 0; i < pack.parts.length; i++) {
    const part = pack.parts[i]!;
    if (rec.files_uploaded.includes(part.file)) continue;
    await uploadListingFile(shopId, rec.listing_id, part.file, i + 1);
    rec.files_uploaded.push(part.file); saveListingMap(map);
    console.log(`  file ${i + 1}/${pack.parts.length} (${(part.bytes / 1e6).toFixed(1)}MB)`);
  }

  const video = videoForPack(slug);
  if (video && rec.video_uploaded !== video) {
    await uploadListingVideo(shopId, rec.listing_id, video);
    rec.video_uploaded = video; saveListingMap(map);
    console.log('  video uploaded');
  }
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const placeholder = process.argv.includes('--placeholder');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('Run `npm run etsy:package` first — packages-manifest.json not found.');
  }
  const packs = (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { packs: PackEntry[] }).packs;
  const copy = loadCopy();

  if (placeholder) {
    const { shop_id } = await getMe();
    const taxonomyId = await resolveTaxonomyId('Digital Prints');
    const pack = packs.find((p) => p.withinEtsyLimits) ?? packs[0]!;
    console.log(`Placeholder draft from pack ${pack.slug} -> shop ${shop_id}`);
    await pushOne(shop_id, taxonomyId, `__placeholder-${pack.slug}`, {
      title: 'PLACEHOLDER - do not publish - pipeline test',
      description: 'Pipeline verification draft. Delete me.',
      tags: ['test'], price: 99.99,
    }, pack);
    console.log('Placeholder draft complete. Verify in Shop Manager, then delete.');
    return;
  }

  // Validate copy coverage.
  const gaps: string[] = [];
  if (!copy) {
    gaps.push(`Copy file not found at ${copyPath} — Marketing has not delivered yet.`);
  } else {
    for (const pack of packs) gaps.push(...validateEntry(pack.slug, copy.get(pack.slug)));
  }
  const blockedPacks = packs.filter((p) => !p.withinEtsyLimits);
  for (const p of blockedPacks) gaps.push(`${p.slug}: ${p.parts.length} ZIP parts exceeds Etsy's 5-file cap — needs a split/quality decision`);

  console.log(`Plan: ${packs.length} packs -> draft listings`);
  for (const p of packs) {
    console.log(`  ${p.slug}: ${p.files} files, ${p.parts.length} zip part(s), copy=${copy?.has(p.slug) ? 'yes' : 'MISSING'}${p.withinEtsyLimits ? '' : ' [OVER LIMIT]'}`);
  }
  if (gaps.length > 0) {
    console.log(`\nGaps (${gaps.length}):`);
    for (const g of gaps) console.log(`  - ${g}`);
  }

  if (!live) { console.log('\nDry-run only. Re-run with --live to create drafts.'); return; }
  if (!copy) throw new Error('Cannot push live without the copy file.');

  const { shop_id } = await getMe();
  const taxonomyId = await resolveTaxonomyId('Digital Prints');
  for (const pack of packs) {
    const entry = copy.get(pack.slug);
    if (!entry || validateEntry(pack.slug, entry).length > 0 || !pack.withinEtsyLimits) {
      console.log(`SKIP ${pack.slug} (gaps above)`); continue;
    }
    console.log(`PUSH ${pack.slug}`);
    await pushOne(shop_id, taxonomyId, pack.slug, entry, pack);
  }
  console.log('\nDone. All listings are DRAFTS — publish requires Dennis approval.');
}

void main().catch((err) => { console.error((err as Error).message); process.exit(1); });
