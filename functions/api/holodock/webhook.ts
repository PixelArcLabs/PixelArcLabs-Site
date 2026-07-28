import type Stripe from 'stripe';
import {
  assertPaidHoloDockSession,
  json,
  stripeClient,
  upsertPurchaseFromSession,
  withEnv,
  type Env,
} from '../../_lib/holodock';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return withEnv(context.env, async () => {
    const req = context.request;
    const signature = req.headers.get('stripe-signature');
    const rawBody = await req.text();

    const liveSecret = context.env.STRIPE_WEBHOOK_SECRET;
    const testSecret = context.env.STRIPE_WEBHOOK_SECRET_TEST;

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
  });
};
