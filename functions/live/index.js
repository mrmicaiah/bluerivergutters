// GET /live/ — Blue River Live, server-rendered (functions/_shared/ssr.js).
import { servePage, redirect } from '../_shared/ssr.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.endsWith('/')) return redirect(url.origin, '/live/');
  return servePage(context, 1);
}
export const onRequestHead = onRequestGet;
