/**
 * panini-mockupgen.mjs — Pixel (art-gen) T9 driver
 * Generates lifestyle/marketing mockups of the T8 wall-art prints as believable
 * framed-on-wall room scenes via Replicate Flux 1.1 Pro, then post-processes
 * each PNG to web-light JPEG via sharp.
 *
 * Output: images/mockups/<bundle-slug>-NN.jpg  (3:2 landscape, ~1600 wide)
 *
 * Approach: generated-scene (the brief's documented fallback). Flux generates a
 * styled room with a portrait-framed antique engraving on the wall whose subject
 * matches a specific T8 piece + brand aesthetic (aged cream paper, sage / ochre /
 * terracotta / antique gold palette). This is conversion imagery: vary frame
 * style + room aesthetic across the set to show range.
 *
 * Run: node panini-mockupgen.mjs            (full run, all shots, ~5 botanist + 5 cosmos)
 *      node panini-mockupgen.mjs --bundle=botanists-kitchen
 *      node panini-mockupgen.mjs --only=1,2
 *      node panini-mockupgen.mjs --dry
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import sharp from './server/node_modules/sharp/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.REPLICATE_API_TOKEN || 'r8_XcHnUNmk9D2CYZTIehTk7UJ45VttVUS4HbQil';
const MODEL = 'black-forest-labs/flux-1.1-pro';
const OUT_DIR = path.join(__dirname, 'images', 'mockups');

const argv = process.argv.slice(2);
const flag = (n) => argv.find((a) => a.startsWith(`--${n}`));
const DRY = !!flag('dry');
const BUNDLE_FILTER = flag('bundle')?.split('=')[1] || null;
const ONLY = (flag('only')?.split('=')[1] || '').split(',').filter(Boolean).map(Number);

function log(m) { console.log(`[mockupgen] ${m}`); }

// --- Shared aesthetic anchor: every mockup should read as the same brand world.
const ROOM_LIGHTING =
  'photoreal interior photography, 35mm lens, soft natural window daylight, ' +
  'warm cinematic color grade, shallow depth of field, gentle film grain, ' +
  'editorial home-decor magazine style, no people, no text, no watermarks, no logos';

const FRAMED_ART_NEGATIVE =
  'NEGATIVE: no neon, no glossy posters, no modern abstract art, no photographic prints, ' +
  'no surreal warping of the framed picture, the framed picture must read as a flat 2D vintage ' +
  'engraving on aged ivory paper, no people, no faces, no text on the wall, no brand logos, ' +
  'no duplicate frames overlapping';

// --- BOTANIST'S KITCHEN — 5 shots
const BOTANIST_SHOTS = [
  {
    n: 1,
    subject: 'rosemary',
    room: 'farmhouse kitchen with cream subway tile backsplash, butcher-block counter, a few sprigs of fresh rosemary in a small ceramic jar, terracotta pots',
    frame: 'natural light oak wood frame, generous off-white mat, slim profile',
    art: 'a single hand-engraved rosemary sprig with fine needle leaves and small pale-blue flowers, painted in soft sage and ochre watercolor wash on aged ivory paper, with a small antique italic label reading "Pl. I — Rosmarinus officinalis" at the base',
  },
  {
    n: 2,
    subject: 'lemon-fig-gallery',
    room: 'sunlit dining nook with linen-upholstered bench, a small wooden side table with a rustic bowl of lemons and a sprig of olive',
    frame: 'gallery wall of three portrait frames hung vertically aligned: left thin matte black, center natural oak, right antique gilt brass — each with generous off-white mat',
    art: 'three different antique botanical engravings — a lemon citrus branch, a fig branch with cut fruit showing pink seeds, and an olive branch with silvery leaves — each in soft sage / ochre / terracotta watercolor wash on aged ivory paper, with tiny antique italic latin labels at the base of each plate',
  },
  {
    n: 3,
    subject: 'lavender',
    room: 'serene bedroom corner with a pale linen duvet, soft plaster wall, a small bedside table with a ceramic vase of dried lavender stems and a beeswax candle',
    frame: 'antique gold gilded thin frame with ornate corner detail, narrow ivory mat',
    art: 'a tall hand-engraved lavender plate with three slender lavender stems in dusty purple and silver-green watercolor wash on aged ivory paper, with antique italic label "Pl. IV — Lavandula angustifolia" at the base',
  },
  {
    n: 4,
    subject: 'herb-bouquet',
    room: 'minimalist home office with a light-oak writing desk, a small open notebook, a vintage brass desk lamp, a small terracotta pot of thyme',
    frame: 'slim matte black metal frame with wide off-white mat, leaning casually against the wall on the back of the desk',
    art: 'an antique botanical engraving of a tied bouquet garni of mixed culinary herbs — rosemary, thyme, sage, and bay leaf bound with twine — painted in sage green, ochre and dusty rose watercolor wash on aged ivory paper, with antique italic label at the base',
  },
  {
    n: 5,
    subject: 'olive-pair',
    room: 'sunlit Mediterranean entryway with whitewashed plaster wall, a reclaimed wood console table, a stone urn with an olive branch',
    frame: 'a pair of matching wide natural oak frames hung side by side, generous off-white mats, classic gallery proportion',
    art: 'two antique botanical engravings side by side — on the left an olive branch with narrow silvery-green leaves and a cluster of dark ripe olives, on the right a garlic bulb beside an onion with papery skins — both in soft sage / ochre / sepia watercolor wash on aged ivory paper, with tiny italic latin labels at the base of each plate',
  },
];

// --- ANTIQUE COSMOS — 5 shots
const COSMOS_SHOTS = [
  {
    n: 1,
    subject: 'northern-star-map',
    room: 'moody study with a deep teal painted wall, a leather wingback chair partially in frame, a small brass globe on a side table, an antique brass desk lamp casting warm light',
    frame: 'wide antique gilt brass ornate frame with deep off-white mat',
    art: 'a large antique northern-hemisphere star map: a circular celestial chart filled with engraved constellations connected by fine lines, latin names, decorative compass rose at top and ornate cartouche at bottom, painted in antique gold and warm sepia engraved linework on a deep ink-navy background, museum celestial chart aesthetic',
  },
  {
    n: 2,
    subject: 'moon-phases',
    room: 'modern bedroom with a charcoal velvet upholstered headboard, soft cream linen pillows, a small brass pendant lamp',
    frame: 'long horizontal wide matte black frame mounted above the headboard, narrow ivory mat (frame oriented landscape over the bed)',
    art: 'an antique chart of the eight phases of the moon arranged in a horizontal row, each phase circled with fine engraved shading, antique italic latin labels beneath each phase (Luna Nova, Crescens, etc.), painted in antique gold engraved linework on a deep ink-navy background',
  },
  {
    n: 3,
    subject: 'zodiac-wheel',
    room: 'eclectic reading nook with a deep emerald green velvet armchair, a small marble side table with a cup of tea and a stack of leather-bound books, woven rug',
    frame: 'antique gold thin frame with wide cream mat, square-ish proportion',
    art: 'an antique circular zodiac wheel divided into twelve segments, each engraved with its zodiac symbol and labelled in italic latin (Aries, Taurus, Gemini, etc.), decorative ornate border, painted in warm sepia and antique gold engraved linework on aged ivory parchment paper',
  },
  {
    n: 4,
    subject: 'orrery-solar',
    room: 'modern minimalist home office with a pale concrete plaster wall, a clean light-oak desk, a small terracotta pot, a vintage brass desk lamp',
    frame: 'slim matte black metal frame with wide off-white mat, museum-style hang',
    art: 'an antique orrery diagram: the sun at center with concentric orbital rings showing the planets Mercurius, Venus, Tellus, Mars, Jupiter, Saturnus, each planet labelled in italic latin, painted in warm sepia and antique gold engraved linework on aged ivory parchment paper',
  },
  {
    n: 5,
    subject: 'orion-ursa-gallery',
    room: 'sophisticated hallway with a warm cream plaster wall, a slim console table with a brass candlestick and a small antique book stack, a runner rug below',
    frame: 'gallery pair of two matching wide antique gilt brass frames hung side by side, deep off-white mats',
    art: 'two antique constellation engravings side by side — on the left the constellation of Orion drawn as the mythological hunter figure in fine engraved line over its star pattern, on the right Ursa Major drawn as the great bear over the big dipper — both labelled in italic latin, painted in antique gold engraved linework on a deep ink-navy background',
  },
];

const BUNDLES = [
  { slug: 'botanists-kitchen', name: "The Botanist's Kitchen", shots: BOTANIST_SHOTS },
  { slug: 'antique-cosmos',    name: 'Antique Cosmos',          shots: COSMOS_SHOTS    },
];

function buildPrompt(shot) {
  return (
    `${ROOM_LIGHTING}. ` +
    `A styled ${shot.room}. ` +
    `On the wall, prominently centered in the composition, hangs a ${shot.frame}, ` +
    `containing ${shot.art}. ` +
    `The framed art is the clear hero subject, sharply in focus, perfectly flat and rectangular on the wall ` +
    `with a subtle realistic drop shadow. The framed picture itself looks like a real flat 2D antique ` +
    `engraving on aged ivory paper — warm cream / amber / terracotta / sage / antique-gold heritage palette, ` +
    `vintage botanical / celestial museum-print aesthetic. ` +
    `${FRAMED_ART_NEGATIVE}.`
  );
}

// ---- HTTP helpers (same pattern as panini-artgen.mjs / replicate-gen.mjs)
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
    get(url);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createPrediction(prompt) {
  const payload = JSON.stringify({
    input: { prompt, aspect_ratio: '3:2', output_format: 'png', output_quality: 90, safety_tolerance: 2 },
  });
  const url = new URL(`https://api.replicate.com/v1/models/${MODEL}/predictions`);
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
  }, payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Create prediction failed: ${res.status} — ${res.body.slice(0, 300)}`);
  }
  return JSON.parse(res.body);
}
async function pollPrediction(id) {
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const res = await httpsRequest(`https://api.replicate.com/v1/predictions/${id}`, {
      method: 'GET', headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status !== 200) throw new Error(`Poll failed: ${res.status}`);
    const d = JSON.parse(res.body);
    if (d.status === 'succeeded') return d;
    if (d.status === 'failed' || d.status === 'canceled') {
      throw new Error(`Prediction ${d.status}: ${d.error || 'no detail'}`);
    }
  }
  throw new Error('Prediction timed out');
}

async function generateShot(bundle, shot) {
  const out = path.join(OUT_DIR, `${bundle.slug}-${String(shot.n).padStart(2, '0')}.jpg`);
  if (fs.existsSync(out)) {
    log(`  ${bundle.slug}-${String(shot.n).padStart(2, '0')}: exists, skipping`);
    return { ok: true, path: out, skipped: true };
  }
  const prompt = buildPrompt(shot);
  log(`  ${bundle.slug}-${String(shot.n).padStart(2, '0')} (${shot.subject}): submitting (3:2)`);
  if (DRY) { log('  [DRY] ' + prompt.slice(0, 160) + '…'); return { ok: true, dry: true }; }
  let pred = await createPrediction(prompt);
  if (pred.status !== 'succeeded') pred = await pollPrediction(pred.id);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new Error('no output url');
  const pngBuf = await downloadToBuffer(url);
  // Web-light JPEG: resize longest edge 1600px, quality 82, mozjpeg.
  await sharp(pngBuf)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  const sz = fs.statSync(out).size;
  log(`  ${bundle.slug}-${String(shot.n).padStart(2, '0')}: saved ${path.basename(out)} (${(sz / 1024).toFixed(0)} KB)`);
  return { ok: true, path: out, sizeKB: Math.round(sz / 1024) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`Output dir: ${OUT_DIR}`);
  log(`Token: ${TOKEN.slice(0, 6)}…${TOKEN.slice(-4)}  Model: ${MODEL}`);
  if (DRY) log('DRY RUN — no API calls');

  const results = [];
  for (const bundle of BUNDLES) {
    if (BUNDLE_FILTER && bundle.slug !== BUNDLE_FILTER) continue;
    log(`\n=== ${bundle.name} (${bundle.slug}) — ${bundle.shots.length} mockups ===`);
    for (const shot of bundle.shots) {
      if (ONLY.length && !ONLY.includes(shot.n)) continue;
      try {
        const r = await generateShot(bundle, shot);
        results.push({ bundle: bundle.slug, n: shot.n, subject: shot.subject, ...r });
      } catch (e) {
        log(`  ERROR ${bundle.slug}-${shot.n}: ${e.message}`);
        results.push({ bundle: bundle.slug, n: shot.n, error: e.message });
      }
      await sleep(1500);
    }
  }

  console.log('\n[mockupgen] === RESULTS ===');
  for (const r of results) console.log(JSON.stringify(r));
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n[mockupgen] ${ok}/${results.length} mockups generated successfully.`);
}

main().catch((e) => { console.error('[mockupgen] FATAL:', e); process.exit(1); });
