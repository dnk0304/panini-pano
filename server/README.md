# Panini Pano — Commerce Backend

Small Node/Express server that adds **cart, orders, PDF packaging, signed downloads, and Whop checkout** to the existing static `panini-pano-website` marketing pages.

The existing static files (index.html, style.css, script.js, images/, videos/) are **not modified**. The server mounts them as static assets and adds an `/api/*` surface alongside.

---

## Quick start (local dev)

```bash
cd server
npm install
cp .env.example .env       # edit if you like; defaults work
npm run migrate            # creates server/data/paninipano.sqlite
npm run seed               # inserts 2 placeholder bundles + sample art
npm run dev                # http://localhost:3030
```

Then in another shell:

```bash
# create a cart
CART=$(curl -s -X POST http://localhost:3030/api/cart | jq -r .id)

# add a placeholder bundle
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"bundleSlug":"vintage-botanicals"}' \
  http://localhost:3030/api/cart/$CART/items | jq

# check out → creates a pending order
ORDER=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}' \
  http://localhost:3030/api/cart/$CART/checkout | jq -r .orderId)

# DEV ONLY: simulate the Whop webhook firing
# (in prod, Whop hits /api/webhooks/whop with an HMAC-signed body)
curl -s -X POST http://localhost:3030/api/orders/$ORDER/mark-paid | jq
```

The last call returns a real signed download URL pointing at a real PDF zip built from the placeholder art. The placeholder art is .txt files by default; replace them in `server/sample-art/` with real PNG/JPG masters and re-run `npm run seed` to build actual print-ready PDFs.

---

## Project layout

```
panini-pano-website/
├── index.html           ← existing static site (untouched)
├── style.css, script.js, images/, videos/, ...
├── Dockerfile           ← multi-stage, bakes site + server
├── .dockerignore
└── server/              ← NEW (this folder)
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── DEPLOY-COOLIFY.md  ← Ken's deploy recipe
    ├── docker-compose.yml ← local-dev convenience
    ├── README.md
    ├── sample-art/        ← placeholder masters (T11 swaps in real art)
    └── src/
        ├── config.ts           ← env validation (zod)
        ├── index.ts            ← express boot
        ├── db/
        │   ├── schema.sql
        │   ├── index.ts        ← better-sqlite3 connection
        │   ├── migrate.ts
        │   └── seed.ts
        ├── lib/
        │   ├── ids.ts          ← UUIDv7
        │   └── logger.ts       ← pino
        ├── middleware/
        │   ├── basic-auth.ts   ← subastas-style login gate (env-driven)
        │   └── error.ts        ← AppError + ZodError → consistent JSON
        ├── routes/
        │   ├── bundles.ts      ← GET /api/bundles, /:slug
        │   ├── cart.ts         ← POST /api/cart, items, checkout
        │   ├── orders.ts       ← GET /api/orders/:id, dev mark-paid stub
        │   ├── checkout.ts     ← POST /api/checkout/whop
        │   ├── downloads.ts    ← GET /api/downloads/:token
        │   └── webhooks-whop.ts← POST /api/webhooks/whop (HMAC verified)
        └── services/
            ├── print-sizes.ts  ← 6 print sizes @ 300 DPI
            ├── pdf-packager.ts ← sharp + pdf-lib → zip
            ├── orders.ts       ← markOrderPaid() — idempotent
            ├── download-tokens.ts ← HMAC-signed stateless tokens
            └── whop.ts         ← createCheckoutSession + verifySignature
```

---

## API summary

| Method | Path | Description |
|---|---|---|
| GET    | `/api/health` | Coolify health check. |
| GET    | `/api/bundles` | List active bundles. |
| GET    | `/api/bundles/:slug` | Bundle detail + prints. |
| POST   | `/api/cart` | Create a server-side cart (cookie-bound). |
| GET    | `/api/cart/:id` | Read cart + items + total. |
| POST   | `/api/cart/:id/items` | Add (or bump qty) a bundle. |
| DELETE | `/api/cart/:id/items/:itemId` | Remove an item. |
| POST   | `/api/cart/:id/checkout` | Lock cart, create pending order. |
| POST   | `/api/checkout/whop` | Create Whop session → returns redirect URL. |
| GET    | `/api/checkout/whop/status` | Debug: is Whop configured? |
| GET    | `/api/orders/:id` | Order detail. |
| POST   | `/api/orders/:id/mark-paid` | **Dev-only** stub (404 in prod). |
| POST   | `/api/webhooks/whop` | Whop event receiver. HMAC verified. |
| GET    | `/api/downloads/:token` | Stream the zip. Token is HMAC-signed. |

All error responses share one shape:
```json
{ "error": { "code": "validation_error", "message": "...", "details": {...}, "requestId": "..." } }
```

---

## Where to plug in what

- **Whop keys** → Coolify env vars `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_BUNDLE_PRODUCT_MAP_JSON`. See `DEPLOY-COOLIFY.md` §3.
- **Real art (T8 / T11)** → drop PNG/JPG masters into `server/sample-art/` (or any path) and update `src/db/seed.ts` `source_path` values, then `npm run seed`. The schema accepts any absolute path; in prod, put masters under `/data/art/` so they live on the persistent volume.
- **Real bundle copy (T2 / T11)** → edit the title/description in the seeder. The schema is frozen so a single re-seed swaps the marketing copy.
- **Cart UI (T7)** → fetch the API surface above. No CSRF required (cookie-bound but mutating routes are POST/DELETE; SameSite=Lax cookie blocks cross-site form posts). For T7 forms, just `fetch(... credentials: 'include')`.
- **Login gate** → currently HTTP Basic Auth (subastas pattern). To swap for Traefik ForwardAuth against dnkpartner's session, remove `createBasicAuthMiddleware()` from `src/index.ts` and add the Traefik label per `DEPLOY-COOLIFY.md` §10.

---

## Security posture

- **No secrets in code.** All from env vars, validated at boot.
- **All SQL parameterized** (better-sqlite3 prepared statements).
- **Zod-validated** every request body, params, query.
- **HMAC-verified** Whop webhooks (constant-time compare).
- **HMAC-signed** download tokens, 24h TTL.
- **No public PDF dirs** — packages live under `/data/packages/`, never `express.static`'d.
- **Rate limited** on `/api/*` (240/min/IP).
- **helmet** security headers; trust-proxy=1 for Traefik.
- **Webhooks bypass basic-auth + cookie parsing** (HMAC is the auth; raw body needed for signature).
