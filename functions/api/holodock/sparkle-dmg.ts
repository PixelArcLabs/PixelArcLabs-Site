import type { Env } from '../../_lib/holodock';

/**
 * Public Sparkle update assets (DMG) from FILES KV.
 * Appcast points here so releases don't depend on Pages static binary upload.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const name = new URL(context.request.url).searchParams.get('file')?.trim() ?? '';
  if (!/^HoloDock-\d+\.\d+\.\d+\.dmg$/.test(name)) {
    return new Response('Not found', { status: 404 });
  }

  const file = await context.env.FILES.get(name, 'arrayBuffer');
  if (!file) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(file, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(file.byteLength),
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
