import {
  COOKIE_NAME,
  MAX_ACTIVATED_DEVICES,
  MAX_DOWNLOADS,
  assertPaidHoloDockSession,
  clientIp,
  getPurchase,
  json,
  maskEmail,
  parseCookies,
  rateLimit,
  verifyBuyerCookie,
  withEnv,
  type Env,
} from '../../_lib/holodock';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return withEnv(context.env, async () => {
    const req = context.request;
    const ip = clientIp(req);
    if (!(await rateLimit(`status:${ip}`, 40, 60_000))) {
      return json(429, { error: 'Too many requests.' });
    }

    const sessionId = new URL(req.url).searchParams.get('session_id')?.trim() ?? '';
    if (!sessionId.startsWith('cs_')) {
      return json(400, { error: 'Missing session_id.' });
    }

    try {
      const result = await assertPaidHoloDockSession(sessionId);
      if (!result.ok) {
        return json(403, { error: 'Purchase not ready or invalid.', reason: result.reason });
      }

      const email =
        result.session.customer_details?.email || result.session.customer_email || null;
      const purchase = await getPurchase(sessionId);

      const cookies = parseCookies(req.headers.get('cookie'));
      const deviceOk = Boolean(verifyBuyerCookie(cookies[COOKIE_NAME], sessionId));

      return json(200, {
        ok: true,
        emailMasked: email ? maskEmail(email) : null,
        deviceBound: Boolean(purchase?.boundDeviceHash),
        deviceTrusted: deviceOk,
        downloadsUsed: purchase?.downloadsUsed ?? 0,
        downloadsRemaining: Math.max(0, MAX_DOWNLOADS - (purchase?.downloadsUsed ?? 0)),
        licenseKeyLast4: purchase?.licenseKeyLast4 ?? null,
        activatedDeviceCount: purchase?.activatedDevices.length ?? 0,
        deviceLimit: MAX_ACTIVATED_DEVICES,
      });
    } catch (error) {
      console.error('holodock-status error', error);
      return json(500, { error: 'Could not check purchase status.' });
    }
  });
};
