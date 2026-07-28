import { randomUUID } from 'node:crypto';
import type { Config, Context } from '@netlify/functions';
import {
  COOKIE_NAME,
  MAX_DOWNLOADS,
  assertPaidHoloDockSession,
  ensureLicenseIndex,
  generateLicenseKey,
  issueDownloadToken,
  json,
  maskEmail,
  normalizeEmail,
  normalizePurchase,
  parseCookies,
  purchaseStore,
  rateLimit,
  setBuyerCookieHeader,
  sha256,
  upsertPurchaseFromSession,
  verifyBuyerCookie,
  type PurchaseRecord,
} from './_lib/holodock';

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const ip = context.ip ?? 'unknown';
  if (!(await rateLimit(`claim:${ip}`, 20, 60_000))) {
    return json(429, { error: 'Too many attempts. Try again in a minute.' });
  }

  let body: { session_id?: string; email?: string };
  try {
    body = (await req.json()) as { session_id?: string; email?: string };
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const sessionId = body.session_id?.trim() ?? '';
  const email = body.email?.trim() ?? '';

  if (!sessionId.startsWith('cs_') || !email.includes('@')) {
    return json(400, { error: 'session_id and checkout email are required.' });
  }

  try {
    const result = await assertPaidHoloDockSession(sessionId);
    if (!result.ok) {
      const messages = {
        unpaid: 'Payment is not complete for this session.',
        expired: 'This purchase download window has expired.',
        wrong_product: 'This checkout session is not a HoloDock purchase.',
      };
      return json(403, { error: messages[result.reason] });
    }

    const purchaseEmail =
      result.session.customer_details?.email || result.session.customer_email;
    if (!purchaseEmail) {
      return json(403, {
        error: 'No email on this purchase. Contact support with your receipt.',
      });
    }

    if (normalizeEmail(purchaseEmail) !== normalizeEmail(email)) {
      return json(403, {
        error: 'Email does not match the email used at checkout.',
      });
    }

    let purchase = await upsertPurchaseFromSession(result.session);
    if (!purchase) {
      return json(500, { error: 'Could not register purchase.' });
    }

    if (purchase.revoked) {
      return json(403, { error: 'This purchase has been revoked. Contact support.' });
    }

    if (purchase.downloadsUsed >= MAX_DOWNLOADS) {
      return json(429, {
        error: `Download limit reached (${MAX_DOWNLOADS}). Contact support with your receipt.`,
      });
    }

    // Email match is the primary gate. Cookie binds the short-lived download token
    // to this browser so a stolen token URL alone is useless.
    const cookies = parseCookies(req.headers.get('cookie'));
    const existingDevice = verifyBuyerCookie(cookies[COOKIE_NAME], sessionId);
    const deviceId = existingDevice ?? randomUUID();

    const store = purchaseStore();
    let licenseKey: string | null = null;
    const next: PurchaseRecord = normalizePurchase({
      ...purchase,
      boundDeviceHash: sha256(deviceId),
      updatedAt: new Date().toISOString(),
    });

    if (!next.licenseKeyHash) {
      licenseKey = generateLicenseKey();
      next.licenseKeyHash = sha256(licenseKey);
      next.licenseKeyLast4 = licenseKey.slice(-4);
    }

    await store.setJSON(sessionId, next);
    if (next.licenseKeyHash) {
      await ensureLicenseIndex(sessionId, next.licenseKeyHash);
    }
    purchase = next;

    const { token, expiresAt } = await issueDownloadToken({
      sessionId,
      emailNormalized: purchase.emailNormalized,
      deviceHash: purchase.boundDeviceHash!,
    });

    return json(
      200,
      {
        ok: true,
        token,
        expiresAt,
        downloadsRemaining: MAX_DOWNLOADS - purchase.downloadsUsed,
        emailMasked: maskEmail(purchase.email),
        licenseKey,
        licenseKeyLast4: purchase.licenseKeyLast4,
      },
      {
        'Set-Cookie': setBuyerCookieHeader(sessionId, deviceId),
      }
    );
  } catch (error) {
    console.error('holodock-claim error', error);
    const message = error instanceof Error ? error.message : 'Claim failed';
    if (message.includes('No such checkout.session')) {
      return json(404, { error: 'Purchase session not found.' });
    }
    return json(500, { error: 'Could not unlock download. Try again or contact support.' });
  }
};

export const config: Config = {
  path: '/api/holodock/claim',
};
