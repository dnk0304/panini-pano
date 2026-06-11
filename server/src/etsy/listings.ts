import fs from 'node:fs';
import path from 'node:path';
import { etsyRequest } from './client';

/**
 * Etsy v3 listing manager — digital downloads, DRAFTS ONLY by default.
 * Publishing (draft -> active) costs $0.20 and requires the explicit
 * env gate ETSY_CONFIRM_PUBLISH=yes. Never called automatically.
 *
 * Idempotency: data/etsy-listings.json maps pack slug -> listing_id (+ asset
 * upload state) so re-runs update instead of duplicating.
 */

const MAP_PATH = path.resolve(__dirname, '..', '..', 'data', 'etsy-listings.json');

export interface ListingRecord {
  listing_id: number;
  created_at: string;
  images_uploaded: string[];
  files_uploaded: string[];
  video_uploaded?: string;
  published?: boolean;
}

export type ListingMap = Record<string, ListingRecord>;

export function loadListingMap(): ListingMap {
  if (!fs.existsSync(MAP_PATH)) return {};
  return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) as ListingMap;
}

export function saveListingMap(map: ListingMap): void {
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
}

// ---------------------------------------------------------------- taxonomy

interface TaxonomyNode { id: number; name: string; children?: TaxonomyNode[] }

/** Resolve a taxonomy id by name (depth-first, case-insensitive). */
export async function resolveTaxonomyId(name: string): Promise<number> {
  const { results } = await etsyRequest<{ results: TaxonomyNode[] }>(
    '/application/seller-taxonomy/nodes',
  );
  const target = name.toLowerCase();
  const stack = [...results];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.name.toLowerCase() === target) return node.id;
    if (node.children) stack.push(...node.children);
  }
  throw new Error(`Taxonomy node not found: "${name}"`);
}

// ---------------------------------------------------------------- listings

export interface DraftListingInput {
  title: string;
  description: string;
  price: number; // USD
  tags: string[]; // max 13
  taxonomy_id: number;
}

export async function createDraftListing(
  shopId: number,
  input: DraftListingInput,
): Promise<{ listing_id: number }> {
  if (input.tags.length > 13) throw new Error(`Etsy allows max 13 tags, got ${input.tags.length}`);
  return etsyRequest<{ listing_id: number }>(`/application/shops/${shopId}/listings`, {
    method: 'POST',
    auth: true,
    json: {
      quantity: 999,
      title: input.title,
      description: input.description,
      price: input.price,
      who_made: 'i_did',
      when_made: '2020_2026',
      taxonomy_id: input.taxonomy_id,
      type: 'download',
      tags: input.tags,
      should_auto_renew: false,
      is_taxable: true,
      state: 'draft',
    },
  });
}

export async function updateListing(
  shopId: number,
  listingId: number,
  patch: Partial<DraftListingInput> & { state?: 'draft' | 'active' },
): Promise<void> {
  await etsyRequest(`/application/shops/${shopId}/listings/${listingId}`, {
    method: 'PATCH',
    auth: true,
    json: patch,
  });
}

function fileForm(field: string, filePath: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  form.append(field, new Blob([buf]), path.basename(filePath));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

/** Listing cover/mockup image (jpg/png, listing shows up to 10). */
export async function uploadListingImage(
  shopId: number,
  listingId: number,
  imagePath: string,
  rank: number,
): Promise<void> {
  await etsyRequest(`/application/shops/${shopId}/listings/${listingId}/images`, {
    method: 'POST',
    auth: true,
    form: fileForm('image', imagePath, { rank: String(rank) }),
  });
}

/** Digital-download file (<=20MB, max 5 per listing). */
export async function uploadListingFile(
  shopId: number,
  listingId: number,
  filePath: string,
  rank: number,
): Promise<void> {
  const size = fs.statSync(filePath).size;
  if (size > 20 * 1024 * 1024) {
    throw new Error(`${path.basename(filePath)} is ${(size / 1e6).toFixed(1)}MB — exceeds Etsy 20MB file cap`);
  }
  await etsyRequest(`/application/shops/${shopId}/listings/${listingId}/files`, {
    method: 'POST',
    auth: true,
    form: fileForm('file', filePath, { name: path.basename(filePath), rank: String(rank) }),
  });
}

/** Listing video (<=100MB, 5-15s, plays muted). */
export async function uploadListingVideo(
  shopId: number,
  listingId: number,
  videoPath: string,
): Promise<void> {
  const size = fs.statSync(videoPath).size;
  if (size > 100 * 1024 * 1024) {
    throw new Error(`${path.basename(videoPath)} exceeds Etsy 100MB video cap`);
  }
  await etsyRequest(`/application/shops/${shopId}/listings/${listingId}/videos`, {
    method: 'POST',
    auth: true,
    form: fileForm('video', videoPath, { name: path.basename(videoPath) }),
  });
}

/**
 * Publish draft -> active. COSTS $0.20. Hard-gated:
 * requires ETSY_CONFIRM_PUBLISH=yes in the environment.
 */
export async function publishListing(shopId: number, listingId: number): Promise<void> {
  if (process.env.ETSY_CONFIRM_PUBLISH !== 'yes') {
    throw new Error(
      'Publish blocked: set ETSY_CONFIRM_PUBLISH=yes to confirm the $0.20 listing fee. ' +
        'Publishing requires Dennis approval — drafts only by default.',
    );
  }
  await updateListing(shopId, listingId, { state: 'active' });
}
