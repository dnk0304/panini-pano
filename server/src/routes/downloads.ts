import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { verifyToken } from '../services/download-tokens';
import { AppError, asyncHandler, requireParam } from '../middleware/error';
import { logger } from '../lib/logger';

export const downloadsRouter = Router();

/**
 * GET /api/downloads/:token — stream the entitlement's zip.
 *
 * The token is signed (HMAC-SHA256) so we don't need to look anything up
 * to verify the signature. We DO consult download_tokens to enforce
 * revocation + record analytics.
 *
 * No basic-auth on this route — the token IS the auth.
 */
downloadsRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const verdict = verifyToken(requireParam(req, 'token'));
    if (!verdict.ok) {
      throw new AppError(403, `token_${verdict.reason}`, 'Download link invalid or expired');
    }

    const db = getDb();
    const tokenRow = db
      .prepare(
        `SELECT id, entitlement_id, expires_at, revoked_at, download_count
         FROM download_tokens WHERE id = ?`,
      )
      .get(verdict.payload.tid) as
      | {
          id: string;
          entitlement_id: string;
          expires_at: string;
          revoked_at: string | null;
          download_count: number;
        }
      | undefined;

    if (!tokenRow) {
      // Signature valid but token unknown → reject (defence in depth).
      throw new AppError(403, 'token_unknown', 'Download link invalid');
    }
    if (tokenRow.revoked_at) {
      throw new AppError(403, 'token_revoked', 'Download link revoked');
    }

    const ent = db
      .prepare(
        `SELECT e.id, e.package_path, e.bundle_id, b.slug AS bundle_slug
         FROM entitlements e JOIN bundles b ON b.id = e.bundle_id
         WHERE e.id = ?`,
      )
      .get(tokenRow.entitlement_id) as
      | { id: string; package_path: string | null; bundle_id: string; bundle_slug: string }
      | undefined;

    if (!ent) throw new AppError(404, 'entitlement_not_found', 'Entitlement gone');
    if (!ent.package_path || !fs.existsSync(ent.package_path)) {
      throw new AppError(409, 'package_not_built', 'Package not built yet — try again shortly');
    }

    // Stamp usage.
    db.prepare(
      `UPDATE download_tokens
       SET download_count = download_count + 1, last_used_at = datetime('now')
       WHERE id = ?`,
    ).run(tokenRow.id);

    const stat = fs.statSync(ent.package_path);
    const filename = `panini-pano-${ent.bundle_slug}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');

    logger.info(
      { entitlementId: ent.id, bundleSlug: ent.bundle_slug, bytes: stat.size },
      'download started',
    );

    fs.createReadStream(ent.package_path).pipe(res);
  }),
);

// Quietly normalise trailing-slash variants for the path-prefix proxy.
downloadsRouter.get(
  '/',
  asyncHandler(async (_req, _res) => {
    throw new AppError(400, 'missing_token', 'Download token required in path');
  }),
);

// Keep an unused import warning silent on lint when path is only needed
// for type-inferred filename. (Used inside basename if we add future
// extensions like reading filename from package_path.)
void path;
