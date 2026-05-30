# PaniniPano — Coolify deployment recipe

**Author:** Forge (T6, 2026-05-30)
**Status:** Schema-only. Ken triggers the actual deploy after Niki verifies the build.
**Pattern:** Single Coolify app, Dockerfile build, Traefik PathPrefix(`/paninipano`) on dnkpartner.com.

This document is mechanical — every value Ken needs to click through Coolify is here.

---

## 1. Pre-flight (5 min)

1. **Git the repo.** The current `C:\Users\D\Desktop\panini-pano-website` is not in git.
   - Ken: create `dnk0304/panini-pano` (PUBLIC, source_id=0 — same pattern as dnkpartner).
   - Initial commit must include the static site + `server/` + `Dockerfile` + `.dockerignore`.
   - Do NOT commit `server/.env`, `server/data/`, or any `node_modules/`.

2. **Generate secrets:**
   ```bash
   openssl rand -hex 32   # → DOWNLOAD_SIGNING_SECRET
   openssl rand -base64 24 # → BASIC_AUTH_PASS
   ```

---

## 2. Coolify app config

| Field | Value |
|---|---|
| Name | `paninipano` |
| Project | `My first project` (uuid `r67ztvicq0j272us7dr4gowp` — same as dnkpartner) |
| Environment | `production` (uuid `dgepxmwcjgk90pyt9hekq44k`) |
| Build pack | **Dockerfile** (not nixpacks — we have native PDF / sharp deps) |
| Dockerfile path | `Dockerfile` (repo root) |
| Build context | `.` |
| Port | `3030` |
| Health check | `GET /api/health` on `:3030`, expect HTTP 200 |
| Git repo | `https://github.com/dnk0304/panini-pano` |
| Git branch | `main` |
| Pre-deployment hook | _none_ (migrations run on container start) |

---

## 3. Required environment variables (Coolify → app → Environment Variables)

| KEY | VALUE | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3030` | |
| `PUBLIC_BASE_URL` | `https://dnkpartner.com/paninipano` | External URL — used in signed download links and Whop redirect URLs. |
| `STATIC_ROOT` | `/app` | Already baked by Dockerfile; override only if you change the COPY layout. |
| `DATA_DIR` | `/data` | Persistent volume mount target. |
| `BASIC_AUTH_USER` | `paninipano` | Picked anything — share with Dennis. |
| `BASIC_AUTH_PASS` | `<openssl rand -base64 24>` | Generated above. |
| `DISABLE_BASIC_AUTH` | `false` | **Must be false in prod.** |
| `DOWNLOAD_SIGNING_SECRET` | `<openssl rand -hex 32>` | Generated above. ROTATE invalidates all live download links. |
| `DOWNLOAD_TOKEN_TTL_HOURS` | `24` | Buyers get 24h on a single link; new link re-issued by hitting GET /api/orders/:id. |

### Whop (LATER — Dennis fork)

Leave these BLANK at first deploy. The app boots in stub mode and surfaces a clear
"Whop not configured" message on checkout. Once Dennis provides keys:

| KEY | VALUE | Notes |
|---|---|---|
| `WHOP_API_KEY` | `<Dennis's Whop API key>` | From Whop dashboard → API. |
| `WHOP_WEBHOOK_SECRET` | `<Dennis's Whop webhook secret>` | From Whop dashboard → Webhooks → create endpoint. |
| `WHOP_BUNDLE_PRODUCT_MAP_JSON` | `{"vintage-botanicals":"prod_abc","fading-films":"prod_xyz"}` | JSON object: bundle slug → Whop product/plan id. One entry per bundle. |
| `WHOP_SUCCESS_URL` | `https://dnkpartner.com/paninipano/checkout/success` | Pixel builds this page in T7. |
| `WHOP_CANCEL_URL` | `https://dnkpartner.com/paninipano/checkout/cancel` | Pixel builds this page in T7. |

---

## 4. Persistent volume

| Volume | Mount path | Purpose |
|---|---|---|
| `paninipano-data` | `/data` | SQLite file (`paninipano.sqlite`) + generated zip packages. |

**SIZE:** start with 5 GB. Each bundle package is ~50–200 MB depending on print count.
Backup the volume nightly (`pg_dump`-equivalent: `tar -czf` the `/data` dir).

---

## 5. Traefik routing — dnkpartner.com/paninipano

Add these labels in the Coolify app's "General → Custom labels" (or under "Network → Traefik labels"):

```yaml
traefik.enable: "true"

# Router: catch any host going to /paninipano
traefik.http.routers.paninipano.rule: "Host(`dnkpartner.com`) && PathPrefix(`/paninipano`)"
traefik.http.routers.paninipano.entrypoints: "https"
traefik.http.routers.paninipano.tls: "true"
traefik.http.routers.paninipano.tls.certresolver: "letsencrypt"
traefik.http.routers.paninipano.middlewares: "paninipano-stripprefix"
traefik.http.routers.paninipano.priority: "100"

# Middleware: strip /paninipano before forwarding to the app. The app is
# path-agnostic — it thinks it lives at the root.
traefik.http.middlewares.paninipano-stripprefix.stripprefix.prefixes: "/paninipano"

# Service: point at port 3030
traefik.http.services.paninipano.loadbalancer.server.port: "3030"
```

**Priority 100** beats the dnkpartner router (which catches `Host(dnkpartner.com)` with default priority). Traefik picks the higher-priority match.

**Quick sanity check after deploy:**
```bash
curl -u paninipano:<BASIC_AUTH_PASS> https://dnkpartner.com/paninipano/api/health
# → {"ok":true,"service":"paninipano",...}
```

---

## 6. Deploy webhook

After creating the app in Coolify, the deploy webhook URL is:
```
http://167.235.53.57:8000/api/v1/deploy?uuid=<APP_UUID>&force=false
```

Ken triggers with:
```bash
curl -X POST -H "Authorization: Bearer <COOLIFY_API_TOKEN>" \
  "http://167.235.53.57:8000/api/v1/deploy?uuid=<APP_UUID>&force=false"
```

(Token in `niki/PROJECTS/dnkpartner/CREDS.md`.)

---

## 7. First-deploy verification (Ken/Niki)

1. `curl -u paninipano:<pw> https://dnkpartner.com/paninipano/api/health` → 200 JSON
2. `curl -u paninipano:<pw> https://dnkpartner.com/paninipano/` → static index.html
3. `curl -u paninipano:<pw> https://dnkpartner.com/paninipano/api/bundles` → 2 placeholder bundles
4. End-to-end (stub mode):
   ```bash
   # create cart
   CART=$(curl -su paninipano:<pw> -X POST https://dnkpartner.com/paninipano/api/cart | jq -r .id)
   # add bundle
   curl -su paninipano:<pw> -X POST -H 'Content-Type: application/json' \
     -d '{"bundleSlug":"vintage-botanicals"}' \
     https://dnkpartner.com/paninipano/api/cart/$CART/items
   # checkout
   ORDER=$(curl -su paninipano:<pw> -X POST -H 'Content-Type: application/json' \
     -d '{"email":"test@example.com"}' \
     https://dnkpartner.com/paninipano/api/cart/$CART/checkout | jq -r .orderId)
   # stub mark-paid (dev only — disabled in prod with NODE_ENV=production)
   # in prod you trigger a real Whop test purchase
   ```
5. Confirm `/data/paninipano.sqlite` exists in the container (`docker exec ... ls /data`).

---

## 8. Going-LIVE checklist (Dennis fork)

Once Dennis is ready for real payments:

- [ ] Create a Whop account.
- [ ] In Whop dashboard, create 1 product/plan PER bundle. Note each `prod_...` id.
- [ ] Whop dashboard → Webhooks → Create endpoint:
      URL = `https://dnkpartner.com/paninipano/api/webhooks/whop`
      Events = `payment.succeeded` (at minimum), optionally `membership.went_valid`.
      Save the signing secret.
- [ ] Whop dashboard → Developers → API key → create.
- [ ] Paste WHOP_API_KEY + WHOP_WEBHOOK_SECRET + WHOP_BUNDLE_PRODUCT_MAP_JSON into Coolify env.
- [ ] Set WHOP_SUCCESS_URL / WHOP_CANCEL_URL to the Pixel-built T7 pages.
- [ ] Redeploy the Coolify app (env changes require restart).
- [ ] Smoke test: complete one real $1 purchase end-to-end; confirm the webhook fires
      and a working download link arrives in the response (or, post-Resend hookup, by email).
- [ ] Once stable, decide on dropping the basic-auth gate:
      - Option A: keep BASIC_AUTH on, give the password to early-access buyers.
      - Option B: set DISABLE_BASIC_AUTH=true → fully public.
- [ ] Buy the real domain → either repoint dnkpartner DNS or stand up the new domain
      as a parallel Coolify domain on the same container.

---

## 9. Backup strategy (recommended, not implemented this wave)

Nightly Coolify scheduled task:
```bash
docker exec <container> tar -czf /tmp/pp-$(date +%F).tar.gz /data
docker cp <container>:/tmp/pp-$(date +%F).tar.gz /backups/paninipano/
```

Retention: 14 daily + 8 weekly. Restore = stop container, untar into volume, start.

---

## 10. Known limitations / followups

- **Multi-bundle checkout** — currently 501s. Whop's single-product checkout is the constraint;
  the order/entitlement schema already supports multiple bundles per order. Switch to Whop's
  multi-line API when available, or split into N orders client-side.
- **Email delivery** — download links are returned in the API response. Pixel's T7 UI should
  show them on the success page. Post-launch, wire Resend (key + DKIM already in dnkpartner) to
  email the link.
- **Auth swap** — when dnkpartner exposes `/api/auth/check`, replace BASIC_AUTH with Traefik
  ForwardAuth so paninipano shares the dnkpartner login session.
