# =====================================================================
# Panini Pano — production image
# Multi-stage on node:20-alpine. Bakes the static marketing site +
# Express commerce server into one container. Listens on $PORT (3030).
# Persistent state lives at /data (mount a Coolify volume here).
# =====================================================================

FROM node:20-alpine AS builder
WORKDIR /app

# Build deps for native modules (better-sqlite3 + sharp). Alpine ships
# musl; sharp + better-sqlite3 both have musl-compatible prebuilds, but
# the toolchain is here as a safety net if a prebuild is missing.
RUN apk add --no-cache python3 make g++ libc6-compat vips-dev

# Copy server package files first for layer-cache friendliness.
COPY server/package.json ./server/package.json
COPY server/package-lock.json* ./server/

WORKDIR /app/server
RUN npm install --no-audit --no-fund --include=dev

# Now copy the rest of the server source.
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src

RUN npm run build

# =====================================================================
# runtime image
# =====================================================================
FROM node:20-alpine AS runtime
WORKDIR /app

# Runtime libs only (no compiler toolchain in the final image).
RUN apk add --no-cache vips tini

# Copy server dist + production node_modules.
COPY --from=builder /app/server/node_modules /app/server/node_modules
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/server/package.json /app/server/package.json
# schema.sql is read at runtime by the migrator — copy it too.
COPY --from=builder /app/server/src/db/schema.sql /app/server/dist/db/schema.sql

# Copy the static marketing site at the repo root (everything except the
# server/ folder, which we already have under /app/server). .dockerignore
# strips node_modules + dev junk.
COPY index.html store.html license.html privacy.html style.css script.js ./
COPY bundles ./bundles
COPY images ./images
COPY branding ./branding
# T12: `videos/`, `Coloring books/`, `images/generated/`, and the non-4x5
# print crops + full-res masters are intentionally NOT shipped on staging
# (wall-art preview only). index.html still LINKS to coloring-book covers
# and promo videos — those links will 404 on staging; that is accepted.
# Full-res prints are the product (delivered separately on order); the PDF
# packager is gated behind the Whop webhook which staging does not run.
# See .gitignore + .dockerignore for the exclusion patterns.

# NOTE: server/sample-art was a placeholder dir for early PDF packager
# work. Real art now ships under /app/images/bundles. Seed + test-package
# both tolerate the dir being absent, so we no longer COPY it.

# Persistent data volume mount-point.
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV STATIC_ROOT=/app
ENV NODE_ENV=production
ENV PORT=3030

EXPOSE 3030

# tini = PID 1 → proper SIGTERM propagation for graceful shutdown.
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app/server
CMD ["node", "dist/index.js"]
