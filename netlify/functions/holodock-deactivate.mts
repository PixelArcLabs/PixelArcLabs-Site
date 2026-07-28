import type { Config, Context } from '@netlify/functions';
import {
  MAX_ACTIVATED_DEVICES,
  ensureLicenseIndex,
  isMasterLicenseKey,
  json,
  loadPurchaseByLicenseKey,
  mutatePurchase,
  rateLimit,
  sha256,
} from './_lib/holodock';

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const ip = context.ip ?? 'unknown';
  if (!(await rateLimit(`deactivate:${ip}`, 20, 60_000))) {
    return json(429, { error: 'Too many attempts. Try again in a minute.' });
  }

  let body: { licenseKey?: string; deviceId?: string };
  try {
    body = (await req.json()) as { licenseKey?: string; deviceId?: string };
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const licenseKey = body.licenseKey?.trim() ?? '';
  const deviceId = body.deviceId?.trim() ?? '';
  if (!licenseKey || !deviceId || deviceId.length < 8) {
    return json(400, { error: 'licenseKey and deviceId are required.' });
  }

  try {
    if (isMasterLicenseKey(licenseKey)) {
      return json(200, {
        ok: true,
        removed: true,
        master: true,
        deviceCount: 0,
        deviceLimit: 99,
      });
    }

    const loaded = await loadPurchaseByLicenseKey(licenseKey);
    if (!loaded.ok) {
      if (loaded.reason === 'bad_format') {
        return json(400, { error: 'Invalid license key format.' });
      }
      return json(404, { error: 'License key not found.' });
    }

    await ensureLicenseIndex(loaded.sessionId, loaded.licenseKeyHash);

    const deviceHash = sha256(deviceId);
    const hadDevice = loaded.purchase.activatedDevices.some((d) => d.deviceHash === deviceHash);

    const mutated = await mutatePurchase(loaded.sessionId, (purchase) => {
      if (purchase.revoked) {
        return {
          error: json(403, { error: 'This license has been revoked.', code: 'revoked' }),
        };
      }
      const devices = purchase.activatedDevices.filter((d) => d.deviceHash !== deviceHash);
      return {
        ...purchase,
        activatedDevices: devices,
        updatedAt: new Date().toISOString(),
      };
    });

    if (!mutated.ok) {
      return mutated.response;
    }

    return json(200, {
      ok: true,
      removed: hadDevice,
      deviceCount: mutated.purchase.activatedDevices.length,
      deviceLimit: MAX_ACTIVATED_DEVICES,
    });
  } catch (error) {
    console.error('holodock-deactivate error', error);
    return json(500, { error: 'Could not deactivate this Mac. Try again later.' });
  }
};

export const config: Config = {
  path: '/api/holodock/deactivate',
};
