# Panini Pano — Project Folder

> *Grab it and go slow.* — Brand tagline

---

## Folder Structure

```
panini-pano-website/
│
├── index.html          ← Main website
├── style.css           ← All styling (30KB)
├── script.js           ← Vanilla JS (animations, lightbox, etc.)
├── serve.js            ← Local dev server: node serve.js → localhost:8888
│
├── images/
│   ├── covers/         ← Amazon + KDP cover images (15 files)
│   ├── pdf-ready/      ← 188 coloring pages organized by book (10 folders)
│   │   ├── bot-dark-botanicals/    (22 pages)
│   │   ├── bot-cottage-garden/     (23 pages)
│   │   ├── bot-mushroom-forest/    (18 pages)
│   │   ├── bot-pressed-flower/     (19 pages)
│   │   ├── bot-tropical-exotic/    (18 pages)
│   │   ├── swe-cat-sass/           (18 pages)
│   │   ├── swe-garden-swear/       (18 pages)
│   │   ├── swe-monday-mood/        (18 pages)
│   │   ├── swe-wellness-swear/     (18 pages)
│   │   └── swe-wine-swear/         (18 pages)
│   └── generated/
│       └── video/
│           ├── book-promos/        ← 4 × 30s book promo videos
│           └── mashup/             ← panini_pano_mashup_all_books.mp4 (80s)
│
├── videos/
│   └── tiktok/
│       ├── girl_botanical_45s.mp4  ← TikTok #1 (48s, woman coloring botanicals)
│       ├── boy_mandala_45s.mp4     ← TikTok #2 (40s, man coloring mandala)
│       └── clips/                  ← Raw 8s source clips (Veo 3.1 + Grok)
│
├── scripts/            ← All generation scripts
│   ├── gen-mashup-compilation.cjs  ← Generated the 80s mashup
│   ├── gen-monday-mood.cjs         ← Generates coloring pages via Imagen 4.0
│   ├── gen-tiktok-v2.cjs           ← Generates TikTok videos (Veo 3.1 / Grok)
│   ├── download-amazon-covers.cjs  ← Downloads book cover images from Amazon
│   └── gemini-batch-70.cjs         ← Batch image generation via Gemini browser
│
└── branding/
    └── panini-pano-branding.md     ← 5 brand options + 20+ hook lines
```

---

## Quick Commands

```bash
# Start local preview
node serve.js     # → http://localhost:8888

# Generate coloring pages (Imagen 4.0 API)
node scripts/gen-monday-mood.cjs

# Generate TikTok videos (Veo 3.1 / Grok)
node scripts/gen-tiktok-v2.cjs

# Download Amazon covers
node scripts/download-amazon-covers.cjs
```

---

## Status

| Task | Status |
|------|--------|
| 188 coloring pages | ✅ Done |
| 10 book covers | ✅ Done |
| 4 book promo videos (30s) | ✅ Done |
| All-books mashup (80s) | ✅ Done |
| 2 TikTok videos (45s) | ✅ Done |
| Website QA / 10-10 pass | ✅ Done |

## Still Needs Deno

| Task | Where |
|------|-------|
| Netlify deploy | netlify.com/drop → drag this folder |
| Gumroad setup | gumroad.com → create product @ £4.99 |
| Per-book Amazon URLs | Send to Cash → wired into website cards |
| Assemble 10 PDFs | Cash handles once all pages verified |
