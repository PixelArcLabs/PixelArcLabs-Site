import {
  MAX_ACTIVATED_DEVICES,
  RECEIPT_TTL_MS,
  clientIp,
  ensureLicenseIndex,
  isMasterLicenseKey,
  json,
  loadPurchaseByLicenseKey,
  masterLicenseReceipt,
  mutatePurchase,
  rateLimit,
  sha256,
  signLicenseReceipt,
  withEnv,
  type ActivatedDevice,
  type Env,
} from '../../_lib/holodock';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return withEnv(context.env, async () => {
    const req = context.request;
    const ip = clientIp(req);
    if (!(await rateLimit(`verify:${ip}`, 30, 60_000))) {
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
        return json(200, masterLicenseReceipt({ licenseKey, deviceId }));
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
      const now = new Date().toISOString();

      const mutated = await mutatePurchase(loaded.sessionId, (purchase) => {
        if (purchase.revoked) {
          return {
            error: json(403, { error: 'This license has been revoked.', code: 'revoked' }),
          };
        }
        if (purchase.licenseKeyHash !== loaded.licenseKeyHash) {
          return { error: json(404, { error: 'License key not found.' }) };
        }

        const devices: ActivatedDevice[] = [...purchase.activatedDevices];
        const existingIdx = devices.findIndex((d) => d.deviceHash === deviceHash);

        if (existingIdx >= 0) {
          devices[existingIdx] = {
            ...devices[existingIdx],
            lastSeenAt: now,
          };
        } else if (devices.length >= MAX_ACTIVATED_DEVICES) {
          return {
            error: json(403, {
              error:
                'This license is already activated on 2 Macs. Deactivate one in HoloDock Settings to free a slot.',
              code: 'device_limit',
              activatedCount: devices.length,
              deviceLimit: MAX_ACTIVATED_DEVICES,
            }),
          };
        } else {
          devices.push({
            deviceHash,
            activatedAt: now,
            lastSeenAt: now,
          });
        }

        return {
          ...purchase,
          activatedDevices: devices,
          updatedAt: now,
        };
      });

      if (!mutated.ok) {
        return mutated.response;
      }

      const purchase = mutated.purchase;
      const issuedAt = Date.now();
      const expiresAt = issuedAt + RECEIPT_TTL_MS;
      const receipt = signLicenseReceipt({
        licenseKeyHash: loaded.licenseKeyHash,
        deviceHash,
        issuedAt,
        expiresAt,
        livemode: purchase.livemode,
      });

      return json(200, {
        ok: true,
        valid: true,
        licenseKeyLast4: purchase.licenseKeyLast4,
        livemode: purchase.livemode,
        deviceCount: purchase.activatedDevices.length,
        deviceLimit: MAX_ACTIVATED_DEVICES,
        issuedAt,
        expiresAt,
        receipt,
      });
    } catch (error) {
      console.error('holodock-verify error', error);
      return json(500, { error: 'Could not verify license. Try again later.' });
    }
  });
};
