import type { Config, Context } from '@netlify/functions';
import {
  assertPaidHoloDockSession,
  json,
  stripeClient,
  upsertPurchaseFromSession,
} from './_lib/holodock';
import type Stripe from 'stripe';

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  // Prefer signed webhook verification when secret is configured.
  const liveSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET');
  const testSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET_TEST');

  if (!signature || (!liveSecret && !testSecret)) {
    return json(400, { error: 'Webhook signature required.' });
  }

  let event: Stripe.Event;
  try {
    const stripeLive = liveSecret ? stripeClient(true) : null;
    const stripeTest = testSecret ? stripeClient(false) : null;
    try {
      if (!stripeLive || !liveSecret) throw new Error('no live');
      event = stripeLive.webhooks.constructEvent(rawBody, signature, liveSecret);
    } catch {
      if (!stripeTest || !testSecret) throw new Error('Webhook signature verification failed');
      event = stripeTest.webhooks.constructEvent(rawBody, signature, testSecret);
    }
  } catch (error) {
    console.error('webhook verify failed', error);
    return json(400, { error: 'Invalid webhook signature.' });
  }

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.id?.startsWith('cs_')) {
        const check = await assertPaidHoloDockSession(session.id);
        if (check.ok) {
          await upsertPurchaseFromSession(check.session);
        }
      }
    }

    return json(200, { received: true });
  } catch (error) {
    console.error('webhook handler error', error);
    return json(500, { error: 'Webhook handler failed.' });
  }
};

export const config: Config = {
  path: '/api/holodock/webhook',
};
