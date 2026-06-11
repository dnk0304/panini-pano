/**
 * One-shot Etsy OAuth2 onboarding CLI.
 *
 * Usage:
 *   ETSY_KEYSTRING=... ETSY_SHARED_SECRET=... npm run etsy:oauth
 *
 * Prereqs (Dennis, one time):
 *   1. In https://www.etsy.com/developers/your-apps -> app settings, add
 *      callback URL EXACTLY:  http://localhost:4477/callback
 *   2. Run this script on the machine where the browser is, open the printed
 *      consent URL, click "Grant access".
 *
 * On success: persists data/etsy-tokens.json (gitignored), verifies with
 * GET /users/me, prints shop_id, and exits.
 */
import express from 'express';
import { generatePkce, buildConsentUrl, exchangeCode } from '../etsy/oauth';
import { ETSY_OAUTH_PORT, ETSY_REDIRECT_URI } from '../etsy/env';
import { getMe } from '../etsy/client';

async function main(): Promise<void> {
  const pkce = generatePkce();
  const consentUrl = buildConsentUrl(pkce);

  const app = express();
  const server = app.listen(ETSY_OAUTH_PORT, () => {
    console.log('--- Etsy OAuth onboarding ---');
    console.log(`Redirect URI (must be registered in Etsy app settings): ${ETSY_REDIRECT_URI}`);
    console.log('\nOpen this consent URL in a browser logged into the Etsy shop account:\n');
    console.log(consentUrl);
    console.log('\nWaiting for callback...');
  });

  app.get('/callback', (req, res) => {
    void (async () => {
      try {
        const { code, state, error, error_description } = req.query as Record<string, string>;
        if (error) throw new Error(`Consent denied: ${error} ${error_description ?? ''}`);
        if (!code) throw new Error('Callback missing ?code');
        if (state !== pkce.state) throw new Error('State mismatch — possible CSRF, aborting.');

        const tokens = await exchangeCode(code, pkce.verifier);
        const me = await getMe();
        console.log(`\nSuccess. Tokens persisted (expires ${new Date(tokens.expires_at).toISOString()}).`);
        console.log(`user_id=${me.user_id} shop_id=${me.shop_id}`);
        res.send('<h2>Etsy connected. You can close this tab.</h2>');
        server.close(() => process.exit(0));
      } catch (err) {
        console.error('OAuth failed:', (err as Error).message);
        res.status(500).send(`<pre>${(err as Error).message}</pre>`);
        server.close(() => process.exit(1));
      }
    })();
  });
}

void main();
