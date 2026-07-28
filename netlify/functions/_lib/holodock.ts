import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import Stripe from 'stripe';

export const LIVE_PRICE_ID = 'price_1TxcfXFQor9UB0NAhE7RwbsA';
export const TEST_PRICE_ID = 'price_1TxctqFQor9UB0NABPI2MnX4';
export const ALLOWED_PRICE_IDS = new Set([LIVE_PRICE_ID, TEST_PRICE_ID]);

export const MAX_DOWNLOADS = 5;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const FILENAME = 'HoloDock-1.0.0.dmg';
export const COOKIE_NAME = 'hd_buyer';

export const LICENSE_KEY_RE = /^HOLO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
export const MAX_ACTIVATED_DEVICES = 2;
export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day offline grace

export type ActivatedDevice = {
  deviceHash: string;
  activatedAt: string;
  lastSeenAt: string;
};

export type PurchaseRecord = {
  sessionId: string;
  email: string;
  emailNormalized: string;
  created: number;
  livemode: boolean;
  downloadsUsed: number;
  /** Legacy download-browser bind; kept for older records. */
  boundDeviceHash: string | null;
  /** App activations (max 2 Macs). */
  activatedDevices: ActivatedDevice[];
  licenseKeyHash: string | null;
  licenseKeyLast4: string | null;
  revoked: boolean;
  updatedAt: string;
};

export type DownloadTokenRecord = {
  tokenHash: string;
  sessionId: string;
  emailNormalized: string;
  expiresAt: number;
  usedAt: string | null;
  deviceHash: string;
};

export type LicenseReceiptPayload = {
  licenseKeyHash: string;
  deviceHash: string;
  issuedAt: number;
  expiresAt: number;
  livemode: boolean;
};

export function json(status: number, body: Record<string, unknown>, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  const visible = user.slice(0, Math.min(1, user.length));
  return `${visible}***@${domain}`;
}

export function signingSecret() {
  const secret = Netlify.env.get('HOLODOCK_DOWNLOAD_SECRET');
  if (!secret) throw new Error('Missing HOLODOCK_DOWNLOAD_SECRET');
  return secret;
}

export function stripeClientForSession(sessionId: string) {
  const isTest = sessionId.startsWith('cs_test_');
  const key = isTest
    ? Netlify.env.get('STRIPE_SECRET_KEY_TEST')
    : Netlify.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new Error(isTest ? 'Missing STRIPE_SECRET_KEY_TEST' : 'Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(key);
}

export function stripeClient(livemode: boolean) {
  const key = livemode
    ? Netlify.env.get('STRIPE_SECRET_KEY')
    : Netlify.env.get('STRIPE_SECRET_KEY_TEST');
  if (!key) {
    throw new Error(livemode ? 'Missing STRIPE_SECRET_KEY' : 'Missing STRIPE_SECRET_KEY_TEST');
  }
  return new Stripe(key);
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string) {
  return createHmac('sha256', signingSecret()).update(value).digest('hex');
}

export function purchaseStore() {
  return getStore({ name: 'holodock-purchases', consistency: 'strong' });
}

export function tokenStore() {
  return getStore('holodock-tokens');
}

export function rateStore() {
  return getStore('holodock-rate');
}

/**
 * Atomically mutate a purchase record using ETag optimistic locking.
 * Retries on concurrent writes so device slots cannot be over-allocated.
 */
export async function mutatePurchase(
  sessionId: string,
  mutate: (purchase: PurchaseRecord) => PurchaseRecord | { error: Response }
): Promise<{ ok: true; purchase: PurchaseRecord } | { ok: false; response: Response }> {
  const store = purchaseStore();
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await store.getWithMetadata(sessionId, {
      type: 'json',
      consistency: 'strong',
    });
    if (!result?.data) {
      return { ok: false, response: json(404, { error: 'Purchase not found.' }) };
    }

    const current = normalizePurchase(result.data as PurchaseRecord);
    const nextOrError = mutate(current);
    if (nextOrError && typeof nextOrError === 'object' && 'error' in nextOrError) {
      return { ok: false, response: nextOrError.error };
    }

    const next = nextOrError as PurchaseRecord;
    const write = await store.setJSON(sessionId, next, {
      onlyIfMatch: result.etag,
    });
    if (write.modified) {
      return { ok: true, purchase: next };
    }
  }

  return {
    ok: false,
    response: json(409, { error: 'Could not update license. Try again.' }),
  };
}

export function licenseIndexKey(licenseKeyHash: string) {
  return `license:${licenseKeyHash}`;
}

export async function ensureLicenseIndex(sessionId: string, licenseKeyHash: string) {
  await purchaseStore().setJSON(licenseIndexKey(licenseKeyHash), sessionId);
}

export function normalizeLicenseKey(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidLicenseKeyFormat(key: string) {
  return LICENSE_KEY_RE.test(key);
}

/**
 * Master activator — plaintext lives only in your password manager.
 * Server stores SHA-256 in HOLODOCK_MASTER_LICENSE_HASH (Netlify secret).
 * Never embed the plaintext in the Mac app or git.
 */
export function isMasterLicenseKey(licenseKey: string) {
  const configured = Netlify.env.get('HOLODOCK_MASTER_LICENSE_HASH')?.trim().toLowerCase();
  if (!configured || configured.length !== 64) return false;
  const key = normalizeLicenseKey(licenseKey);
  if (!isValidLicenseKeyFormat(key)) return false;
  const actual = sha256(key);
  try {
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(configured, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function masterLicenseReceipt(opts: {
  licenseKey: string;
  deviceId: string;
}) {
  const key = normalizeLicenseKey(opts.licenseKey);
  const licenseKeyHash = sha256(key);
  const deviceHash = sha256(opts.deviceId);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + RECEIPT_TTL_MS;
  const receipt = signLicenseReceipt({
    licenseKeyHash,
    deviceHash,
    issuedAt,
    expiresAt,
    livemode: true,
  });
  return {
    ok: true as const,
    valid: true as const,
    master: true as const,
    licenseKeyLast4: key.slice(-4),
    livemode: true,
    deviceCount: 1,
    deviceLimit: 99,
    issuedAt,
    expiresAt,
    receipt,
  };
}

/** Ensure activatedDevices is always an array (older records may omit it). */
export function normalizePurchase(record: PurchaseRecord): PurchaseRecord {
  const devices = Array.isArray(record.activatedDevices) ? [...record.activatedDevices] : [];
  return { ...record, activatedDevices: devices };
}

export function signLicenseReceipt(payload: LicenseReceiptPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(body);
  return `${body}.${sig}`;
}

export function verifyLicenseReceipt(receipt: string): LicenseReceiptPayload | null {
  const parts = receipt.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicenseReceiptPayload;
    if (
      typeof payload.licenseKeyHash !== 'string' ||
      typeof payload.deviceHash !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      typeof payload.livemode !== 'boolean'
    ) {
      return null;
    }
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function assertPaidHoloDockSession(sessionId: string) {
  const stripe = stripeClientForSession(sessionId);
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items.data.price.product'],
  });

  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    return { ok: false as const, reason: 'unpaid' as const, session };
  }

  const createdMs = (session.created ?? 0) * 1000;
  if (createdMs && Date.now() - createdMs > MAX_AGE_MS) {
    return { ok: false as const, reason: 'expired' as const, session };
  }

  const lineItems =
    session.line_items?.data ??
    (await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 })).data;

  const hasHoloDock = lineItems.some((item) => {
    const priceId = typeof item.price === 'string' ? item.price : item.price?.id;
    if (priceId && ALLOWED_PRICE_IDS.has(priceId)) return true;
    const product = typeof item.price !== 'string' ? item.price?.product : null;
    if (product && typeof product !== 'string') {
      return product.metadata?.app === 'holodock' || product.name === 'HoloDock';
    }
    return false;
  });

  if (!hasHoloDock) {
    return { ok: false as const, reason: 'wrong_product' as const, session };
  }

  return { ok: true as const, session, lineItems };
}

export async function upsertPurchaseFromSession(session: Stripe.Checkout.Session) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) return null;

  const store = purchaseStore();
  const existingRaw = (await store.get(session.id, { type: 'json' })) as PurchaseRecord | null;
  const existing = existingRaw ? normalizePurchase(existingRaw) : null;
  const record: PurchaseRecord = {
    sessionId: session.id,
    email,
    emailNormalized: normalizeEmail(email),
    created: session.created ?? Math.floor(Date.now() / 1000),
    livemode: Boolean(session.livemode),
    downloadsUsed: existing?.downloadsUsed ?? 0,
    boundDeviceHash: existing?.boundDeviceHash ?? null,
    activatedDevices: existing?.activatedDevices ?? [],
    licenseKeyHash: existing?.licenseKeyHash ?? null,
    licenseKeyLast4: existing?.licenseKeyLast4 ?? null,
    revoked: existing?.revoked ?? false,
    updatedAt: new Date().toISOString(),
  };
  await store.setJSON(session.id, record);

  // Secondary index by email for recovery lookups
  const emailKey = `email:${record.emailNormalized}`;
  const emailIndex = ((await store.get(emailKey, { type: 'json' })) as string[] | null) ?? [];
  if (!emailIndex.includes(session.id)) {
    emailIndex.push(session.id);
    await store.setJSON(emailKey, emailIndex);
  }

  if (record.licenseKeyHash) {
    await ensureLicenseIndex(session.id, record.licenseKeyHash);
  }

  return record;
}

export function generateLicenseKey() {
  const raw = randomBytes(8).toString('hex').toUpperCase();
  // HOLO-XXXX-XXXX-XXXX
  return `HOLO-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

export function buyerCookieValue(sessionId: string, deviceId: string) {
  const payload = `${sessionId}.${deviceId}`;
  return `${payload}.${hmac(payload)}`;
}

export function verifyBuyerCookie(value: string | undefined, sessionId: string) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [sid, deviceId, sig] = parts;
  if (sid !== sessionId || !deviceId || !sig) return null;
  const expected = hmac(`${sid}.${deviceId}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return deviceId;
}

export function setBuyerCookieHeader(sessionId: string, deviceId: string) {
  const value = buyerCookieValue(sessionId, deviceId);
  const maxAge = Math.floor(MAX_AGE_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const store = rateStore();
  const key = `${bucket}:${Math.floor(Date.now() / windowMs)}`;
  const current = ((await store.get(key, { type: 'json' })) as number | null) ?? 0;
  if (current >= limit) return false;
  await store.setJSON(key, current + 1);
  return true;
}

export async function issueDownloadToken(opts: {
  sessionId: string;
  emailNormalized: string;
  deviceHash: string;
}) {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = sha256(token);
  const record: DownloadTokenRecord = {
    tokenHash,
    sessionId: opts.sessionId,
    emailNormalized: opts.emailNormalized,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    usedAt: null,
    deviceHash: opts.deviceHash,
  };
  await tokenStore().setJSON(tokenHash, record);
  return { token, expiresAt: record.expiresAt };
}

export async function loadPurchaseByLicenseKey(licenseKey: string) {
  const key = normalizeLicenseKey(licenseKey);
  if (!isValidLicenseKeyFormat(key)) {
    return { ok: false as const, reason: 'bad_format' as const };
  }

  const hash = sha256(key);
  const store = purchaseStore();
  const sessionId = (await store.get(licenseIndexKey(hash), { type: 'json' })) as string | null;
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false as const, reason: 'unknown' as const };
  }

  const raw = (await store.get(sessionId, { type: 'json' })) as PurchaseRecord | null;
  if (!raw) {
    return { ok: false as const, reason: 'unknown' as const };
  }

  const purchase = normalizePurchase(raw);
  if (purchase.licenseKeyHash !== hash) {
    return { ok: false as const, reason: 'unknown' as const };
  }

  return { ok: true as const, purchase, licenseKey: key, licenseKeyHash: hash, sessionId };
}
