// GET /live/page/<n>/ — Blue River Live's archive (functions/_shared/ssr.js).
// /live/page/1/ is /live/; anything but a plain page number 404s.
import { servePage, redirect, notFound } from '../../_shared/ssr.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const raw = String(context.params.n);
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) {
    return notFound({ env: context.env, origin: url.origin });
  }
  const n = Number(raw);
  if (n === 1) return redirect(url.origin, '/live/');
  if (!url.pathname.endsWith('/')) return redirect(url.origin, '/live/page/' + n + '/');
  return servePage(context, n);
}
export const onRequestHead = onRequestGet;
