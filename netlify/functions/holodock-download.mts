import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, Context } from '@netlify/functions';
import {
  COOKIE_NAME,
  FILENAME,
  MAX_DOWNLOADS,
  json,
  maskEmail,
  parseCookies,
  purchaseStore,
  rateLimit,
  sha256,
  tokenStore,
  verifyBuyerCookie,
  type DownloadTokenRecord,
  type PurchaseRecord,
} from './_lib/holodock';

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { error: 'Method not allowed' });
  }

  const ip = context.ip ?? 'unknown';
  if (!(await rateLimit(`dl:${ip}`, 30, 60_000))) {
    return json(429, { error: 'Too many download attempts. Try again shortly.' });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token')?.trim();
  const sessionProbe = url.searchParams.get('session_id');

  // Hard block legacy session_id downloads
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
    const store = tokenStore();
    const record = (await store.get(tokenHash, { type: 'json' })) as DownloadTokenRecord | null;

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

    const purchases = purchaseStore();
    const purchase = (await purchases.get(record.sessionId, {
      type: 'json',
    })) as PurchaseRecord | null;

    if (!purchase || purchase.revoked) {
      return json(403, { error: 'Purchase not found or revoked.' });
    }
    if (purchase.downloadsUsed >= MAX_DOWNLOADS) {
      return json(429, {
        error: `Download limit reached (${MAX_DOWNLOADS}). Contact support with your receipt.`,
      });
    }

    // Consume token first (single-use)
    await store.setJSON(tokenHash, {
      ...record,
      usedAt: new Date().toISOString(),
    } satisfies DownloadTokenRecord);

    const nextPurchase: PurchaseRecord = {
      ...purchase,
      downloadsUsed: purchase.downloadsUsed + 1,
      updatedAt: new Date().toISOString(),
    };
    await purchases.setJSON(record.sessionId, nextPurchase);

    const filePath = join(process.cwd(), 'private', 'downloads', FILENAME);
    const file = await readFile(filePath);

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
};

export const config: Config = {
  path: '/api/holodock/download',
};
