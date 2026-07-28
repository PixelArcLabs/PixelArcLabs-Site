import {
  clientIp,
  json,
  rateLimit,
  withEnv,
  type Env,
} from '../_lib/holodock';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return withEnv(context.env, async () => {
    const req = context.request;
    const ip = clientIp(req);
    if (!(await rateLimit(`contact:${ip}`, 8, 60_000))) {
      return json(429, { error: 'Too many messages. Try again shortly.' });
    }

    let body: {
      name?: string;
      email?: string;
      message?: string;
      botField?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: 'Invalid JSON body.' });
    }

    if (body.botField) {
      return json(200, { ok: true });
    }

    const name = body.name?.trim() ?? '';
    const email = body.email?.trim() ?? '';
    const message = body.message?.trim() ?? '';

    if (!name || !email.includes('@') || message.length < 2) {
      return json(400, { error: 'Name, email, and message are required.' });
    }

    const apiKey = context.env.RESEND_API_KEY;
    if (!apiKey) {
      return json(500, { error: 'Contact form is not configured.' });
    }

    const to = context.env.CONTACT_TO || 'hello@pixelarclabs.com';
    const from = context.env.RESEND_FROM || 'Pixel Arc Labs <onboarding@resend.dev>';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          reply_to: email,
          subject: `Contact form: ${name}`,
          text: `From: ${name} <${email}>\n\n${message}`,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('resend error', res.status, errText);
        return json(502, { error: 'Could not send message. Email me directly instead.' });
      }

      return json(200, { ok: true });
    } catch (error) {
      console.error('contact error', error);
      return json(500, { error: 'Could not send message. Try again later.' });
    }
  });
};
