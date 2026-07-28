import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';

export const LIVE_PRICE_ID = 'price_1TxcfXFQor9UB0NAhE7RwbsA';
export const TEST_PRICE_ID = 'price_1TxctqFQor9UB0NABPI2MnX4';
export const ALLOWED_PRICE_IDS = new Set([LIVE_PRICE_ID, TEST_PRICE_ID]);

export const MAX_DOWNLOADS = 5;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const TOKEN_TTL_MS = 10 * 60 * 1000;
export const FILENAME = 'HoloDock-1.0.8.dmg';
export const COOKIE_NAME = 'hd_buyer';

export const LICENSE_KEY_RE = /^HOLO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
export const MAX_ACTIVATED_DEVICES = 2;
export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Env = {
  DB: D1Database;
  RATE: KVNamespace;
  FILES: KVNamespace;
  HOLODOCK_DOWNLOAD_SECRET: string;
  HOLODOCK_MASTER_LICENSE_HASH?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_SECRET_KEY_TEST: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_WEBHOOK_SECRET_TEST: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  CONTACT_TO?: string;
};

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
  boundDeviceHash: string | null;
  activatedDevices: ActivatedDevice[];
  licenseKeyHash: string | null;
  licenseKeyLast4: string | null;
  revoked: boolean;
  updatedAt: string;
  version: number;
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

const envAls = new AsyncLocalStorage<Env>();

export function withEnv<T>(env: Env, fn: () => T): T {
  return envAls.run(env, fn);
}

export function env(): Env {
  const e = envAls.getStore();
  if (!e) throw new Error('Env not bound for this request');
  return e;
}

export function clientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

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
  const secret = env().HOLODOCK_DOWNLOAD_SECRET;
  if (!secret) throw new Error('Missing HOLODOCK_DOWNLOAD_SECRET');
  return secret;
}

export function stripeClientForSession(sessionId: string) {
  const isTest = sessionId.startsWith('cs_test_');
  const key = isTest ? env().STRIPE_SECRET_KEY_TEST : env().STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(isTest ? 'Missing STRIPE_SECRET_KEY_TEST' : 'Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(key);
}

export function stripeClient(livemode: boolean) {
  const key = livemode ? env().STRIPE_SECRET_KEY : env().STRIPE_SECRET_KEY_TEST;
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

export function normalizeLicenseKey(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidLicenseKeyFormat(key: string) {
  return LICENSE_KEY_RE.test(key);
}

export function normalizePurchase(record: PurchaseRecord): PurchaseRecord {
  const devices = Array.isArray(record.activatedDevices) ? [...record.activatedDevices] : [];
  return { ...record, activatedDevices: devices, version: record.version ?? 1 };
}

function rowToPurchase(row: Record<string, unknown>): PurchaseRecord {
  let devices: ActivatedDevice[] = [];
  try {
    devices = JSON.parse(String(row.activated_devices || '[]')) as ActivatedDevice[];
  } catch {
    devices = [];
  }
  return normalizePurchase({
    sessionId: String(row.session_id),
    email: String(row.email),
    emailNormalized: String(row.email_normalized),
    created: Number(row.created),
    livemode: Boolean(row.livemode),
    downloadsUsed: Number(row.downloads_used ?? 0),
    boundDeviceHash: row.bound_device_hash ? String(row.bound_device_hash) : null,
    activatedDevices: devices,
    licenseKeyHash: row.license_key_hash ? String(row.license_key_hash) : null,
    licenseKeyLast4: row.license_key_last4 ? String(row.license_key_last4) : null,
    revoked: Boolean(row.revoked),
    updatedAt: String(row.updated_at),
    version: Number(row.version ?? 1),
  });
}

export async function getPurchase(sessionId: string): Promise<PurchaseRecord | null> {
  const row = await env()
    .DB.prepare('SELECT * FROM purchases WHERE session_id = ?')
    .bind(sessionId)
    .first();
  if (!row) return null;
  return rowToPurchase(row as Record<string, unknown>);
}

export async function savePurchase(record: PurchaseRecord) {
  const p = normalizePurchase(record);
  await env()
    .DB.prepare(
      `INSERT INTO purchases (
        session_id, email, email_normalized, created, livemode, downloads_used,
        bound_device_hash, activated_devices, license_key_hash, license_key_last4,
        revoked, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        email = excluded.email,
        email_normalized = excluded.email_normalized,
        created = excluded.created,
        livemode = excluded.livemode,
        downloads_used = excluded.downloads_used,
        bound_device_hash = excluded.bound_device_hash,
        activated_devices = excluded.activated_devices,
        license_key_hash = excluded.license_key_hash,
        license_key_last4 = excluded.license_key_last4,
        revoked = excluded.revoked,
        updated_at = excluded.updated_at,
        version = excluded.version`
    )
    .bind(
      p.sessionId,
      p.email,
      p.emailNormalized,
      p.created,
      p.livemode ? 1 : 0,
      p.downloadsUsed,
      p.boundDeviceHash,
      JSON.stringify(p.activatedDevices),
      p.licenseKeyHash,
      p.licenseKeyLast4,
      p.revoked ? 1 : 0,
      p.updatedAt,
      p.version
    )
    .run();
}

export async function mutatePurchase(
  sessionId: string,
  mutate: (purchase: PurchaseRecord) => PurchaseRecord | { error: Response }
): Promise<{ ok: true; purchase: PurchaseRecord } | { ok: false; response: Response }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await getPurchase(sessionId);
    if (!current) {
      return { ok: false, response: json(404, { error: 'Purchase not found.' }) };
    }

    const nextOrError = mutate(current);
    if (nextOrError && typeof nextOrError === 'object' && 'error' in nextOrError) {
      return { ok: false, response: nextOrError.error };
    }

    const next = normalizePurchase(nextOrError as PurchaseRecord);
    const newVersion = current.version + 1;
    const result = await env()
      .DB.prepare(
        `UPDATE purchases SET
          email = ?, email_normalized = ?, created = ?, livemode = ?, downloads_used = ?,
          bound_device_hash = ?, activated_devices = ?, license_key_hash = ?, license_key_last4 = ?,
          revoked = ?, updated_at = ?, version = ?
         WHERE session_id = ? AND version = ?`
      )
      .bind(
        next.email,
        next.emailNormalized,
        next.created,
        next.livemode ? 1 : 0,
        next.downloadsUsed,
        next.boundDeviceHash,
        JSON.stringify(next.activatedDevices),
        next.licenseKeyHash,
        next.licenseKeyLast4,
        next.revoked ? 1 : 0,
        next.updatedAt,
        newVersion,
        sessionId,
        current.version
      )
      .run();

    if ((result.meta.changes ?? 0) > 0) {
      return { ok: true, purchase: { ...next, version: newVersion } };
    }
  }

  return {
    ok: false,
    response: json(409, { error: 'Could not update license. Try again.' }),
  };
}

export async function ensureLicenseIndex(sessionId: string, licenseKeyHash: string) {
  // Covered by unique index on purchases.license_key_hash; keep purchase row authoritative.
  const row = await getPurchase(sessionId);
  if (row && row.licenseKeyHash !== licenseKeyHash) {
    await savePurchase({ ...row, licenseKeyHash, updatedAt: new Date().toISOString() });
  }
}

export function isMasterLicenseKey(licenseKey: string) {
  const configured = env().HOLODOCK_MASTER_LICENSE_HASH?.trim().toLowerCase();
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

export function masterLicenseReceipt(opts: { licenseKey: string; deviceId: string }) {
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

export function signLicenseReceipt(payload: LicenseReceiptPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(body);
  return `${body}.${sig}`;
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

  const existing = await getPurchase(session.id);
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
    version: existing?.version ?? 1,
  };
  await savePurchase(record);
  return record;
}

export function generateLicenseKey() {
  const raw = randomBytes(8).toString('hex').toUpperCase();
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
  const key = `${bucket}:${Math.floor(Date.now() / windowMs)}`;
  const currentRaw = await env().RATE.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (current >= limit) return false;
  await env().RATE.put(key, String(current + 1), {
    expirationTtl: Math.max(60, Math.ceil(windowMs / 1000) * 2),
  });
  return true;
}

export async function issueDownloadToken(opts: {
  sessionId: string;
  emailNormalized: string;
  deviceHash: string;
}) {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = sha256(token);
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await env()
    .DB.prepare(
      `INSERT INTO download_tokens (token_hash, session_id, email_normalized, expires_at, used_at, device_hash)
       VALUES (?, ?, ?, ?, NULL, ?)`
    )
    .bind(tokenHash, opts.sessionId, opts.emailNormalized, expiresAt, opts.deviceHash)
    .run();
  return { token, expiresAt };
}

export async function getDownloadToken(tokenHash: string): Promise<DownloadTokenRecord | null> {
  const row = await env()
    .DB.prepare('SELECT * FROM download_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first();
  if (!row) return null;
  return {
    tokenHash: String(row.token_hash),
    sessionId: String(row.session_id),
    emailNormalized: String(row.email_normalized),
    expiresAt: Number(row.expires_at),
    usedAt: row.used_at ? String(row.used_at) : null,
    deviceHash: String(row.device_hash),
  };
}

export async function markTokenUsed(tokenHash: string, usedAt: string) {
  await env()
    .DB.prepare('UPDATE download_tokens SET used_at = ? WHERE token_hash = ?')
    .bind(usedAt, tokenHash)
    .run();
}

export async function loadPurchaseByLicenseKey(licenseKey: string) {
  const key = normalizeLicenseKey(licenseKey);
  if (!isValidLicenseKeyFormat(key)) {
    return { ok: false as const, reason: 'bad_format' as const };
  }

  const hash = sha256(key);
  const row = await env()
    .DB.prepare('SELECT * FROM purchases WHERE license_key_hash = ?')
    .bind(hash)
    .first();
  if (!row) {
    return { ok: false as const, reason: 'unknown' as const };
  }

  const purchase = rowToPurchase(row as Record<string, unknown>);
  if (purchase.licenseKeyHash !== hash) {
    return { ok: false as const, reason: 'unknown' as const };
  }

  return {
    ok: true as const,
    purchase,
    licenseKey: key,
    licenseKeyHash: hash,
    sessionId: purchase.sessionId,
  };
}
