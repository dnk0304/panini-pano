-- PaniniPano commerce schema (SQLite).
-- Conventions:
--   - All ids are UUID v7 strings (lex-sortable).
--   - timestamps are ISO-8601 UTC strings.
--   - soft delete via deleted_at on long-lived rows (bundles, prints).
--   - money in CENTS (integer), currency = USD by default.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =====================================================================
-- catalog
-- =====================================================================

CREATE TABLE IF NOT EXISTS bundles (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  cover_image     TEXT,                          -- relative path under STATIC_ROOT
  price_cents     INTEGER NOT NULL,              -- base bundle price
  currency        TEXT NOT NULL DEFAULT 'USD',
  whop_product_id TEXT,                          -- optional override; usually mapped via env
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bundles_active   ON bundles(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bundles_slug     ON bundles(slug);

CREATE TABLE IF NOT EXISTS prints (
  id              TEXT PRIMARY KEY,
  bundle_id       TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,                 -- unique within bundle
  title           TEXT NOT NULL,
  source_path     TEXT NOT NULL,                 -- absolute or DATA_DIR-relative path to the highest-res master (PNG/JPG)
  source_width_px INTEGER NOT NULL,
  source_height_px INTEGER NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE(bundle_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_prints_bundle ON prints(bundle_id);

-- =====================================================================
-- carts (cookie-bound, server-side)
-- =====================================================================

CREATE TABLE IF NOT EXISTS carts (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Lifecycle: 'open' (mutable) | 'checked_out' (locked, points to order) | 'abandoned'
  status          TEXT NOT NULL DEFAULT 'open',
  checked_out_order_id TEXT REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id              TEXT PRIMARY KEY,
  cart_id         TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  bundle_id       TEXT NOT NULL REFERENCES bundles(id),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,              -- snapshot at add time
  currency        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cart_id, bundle_id)                     -- one row per bundle; bump quantity instead
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- =====================================================================
-- orders + entitlements
-- =====================================================================

CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,
  cart_id             TEXT REFERENCES carts(id),     -- nullable: future direct-buy
  customer_email      TEXT,                          -- captured at checkout (Whop returns it)
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | paid | fulfilled | refunded | cancelled
  total_cents         INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  -- Payment provider linkage. 'stub' for dev; 'whop' in prod.
  payment_provider    TEXT NOT NULL DEFAULT 'whop',
  provider_session_id TEXT,                          -- whop checkout session id
  provider_payment_id TEXT,                          -- whop payment id from webhook
  paid_at             TEXT,
  fulfilled_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_provider_sess  ON orders(provider_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_email          ON orders(customer_email);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bundle_id       TEXT NOT NULL REFERENCES bundles(id),
  quantity        INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  currency        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS entitlements (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bundle_id       TEXT NOT NULL REFERENCES bundles(id),
  -- Path to the built package (zip). Built lazily after webhook fires.
  package_path    TEXT,
  package_built_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_id, bundle_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_order ON entitlements(order_id);

-- =====================================================================
-- download tokens (signed externally with HMAC; this table tracks
-- issuance for revocation/audit. The signature itself is the source of
-- truth — we don't have to look up the token to validate.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS download_tokens (
  id              TEXT PRIMARY KEY,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  download_count  INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dl_tokens_entitlement ON download_tokens(entitlement_id);
CREATE INDEX IF NOT EXISTS idx_dl_tokens_expires     ON download_tokens(expires_at);

-- =====================================================================
-- webhook idempotency
-- =====================================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT PRIMARY KEY,          -- provider event id (e.g. evt_...)
  provider        TEXT NOT NULL,             -- 'whop'
  event_type      TEXT NOT NULL,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  payload_json    TEXT NOT NULL,
  processed_at    TEXT,
  process_error   TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed_at);
