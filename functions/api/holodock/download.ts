import {
  COOKIE_NAME,
  FILENAME,
  MAX_DOWNLOADS,
  clientIp,
  getDownloadToken,
  getPurchase,
  json,
  markTokenUsed,
  maskEmail,
  parseCookies,
  rateLimit,
  savePurchase,
  sha256,
  verifyBuyerCookie,
  withEnv,
  type Env,
  type PurchaseRecord,
} from '../../_lib/holodock';

export const onRequestGet: PagesFunction<Env> = async (context) => handle(context);
export const onRequestHead: PagesFunction<Env> = async (context) => handle(context);

async function handle(context: EventContext<Env, string, unknown>) {
  return withEnv(context.env, async () => {
    const req = context.request;
    const ip = clientIp(req);
    if (!(await rateLimit(`dl:${ip}`, 30, 60_000))) {
      return json(429, { error: 'Too many download attempts. Try again shortly.' });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get('token')?.trim();
    const sessionProbe = url.searchParams.get('session_id');

    if (sessionProbe && !token) {
      return json(401, {
        error:
          'Downloads now require email verification. Open your purchase thank-you page and confirm your checkout email.',
      });
    }

    if (!token) {
      return json(400, { error: 'Missing download token.' });
    }

    try {
      const tokenHash = sha256(token);
      const record = await getDownloadToken(tokenHash);

      if (!record) {
        return json(403, { error: 'Invalid or expired download token.' });
      }
      if (record.usedAt) {
        return json(403, { error: 'This download token was already used. Claim a new one.' });
      }
      if (Date.now() > record.expiresAt) {
        return json(403, { error: 'This download token expired. Claim a new one.' });
      }

      const cookies = parseCookies(req.headers.get('cookie'));
      const deviceId = verifyBuyerCookie(cookies[COOKIE_NAME], record.sessionId);
      if (!deviceId || sha256(deviceId) !== record.deviceHash) {
        return json(403, {
          error: 'Download locked to the verified browser. Re-claim from the thank-you page.',
        });
      }

      const purchase = await getPurchase(record.sessionId);
      if (!purchase || purchase.revoked) {
        return json(403, { error: 'Purchase not found or revoked.' });
      }
      if (purchase.downloadsUsed >= MAX_DOWNLOADS) {
        return json(429, {
          error: `Download limit reached (${MAX_DOWNLOADS}). Contact support with your receipt.`,
        });
      }

      await markTokenUsed(tokenHash, new Date().toISOString());

      const nextPurchase: PurchaseRecord = {
        ...purchase,
        downloadsUsed: purchase.downloadsUsed + 1,
        updatedAt: new Date().toISOString(),
        version: purchase.version + 1,
      };
      await savePurchase(nextPurchase);

      const file = await context.env.FILES.get(FILENAME, 'arrayBuffer');
      if (!file) {
        return json(500, { error: 'Download file missing. Contact support.' });
      }

      if (req.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${FILENAME}"`,
            'Content-Length': String(file.byteLength),
            'Cache-Control': 'no-store',
          },
        });
      }

      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${FILENAME}"`,
          'Content-Length': String(file.byteLength),
          'Cache-Control': 'no-store',
          'X-HoloDock-Downloads-Used': String(nextPurchase.downloadsUsed),
          'X-HoloDock-Buyer': maskEmail(purchase.email),
        },
      });
    } catch (error) {
      console.error('holodock-download error', error);
      return json(500, { error: 'Download failed. Claim a new token and try again.' });
    }
  });
}
