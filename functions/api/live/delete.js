// POST /api/live/delete — removes one Blue River Live post.
//
//   in:  { token, id }      id = the feed's post id (Cloudinary public_id)
//   out: { ok: true }
//
// Only assets tagged brg-live can be deleted: anything else answers 404, so
// the Live token can't reach the site's other Cloudinary images. The destroy
// also invalidates the CDN copy. The feed cache may still list the post for
// up to ~60s. Bad token -> the same 403 after ~1s as /api/live/sign.
import { API_BASE, LIVE_TAG, json, missingEnv, tokenOk, forbidden, readBody, cloudinarySignature, basicAuth, idPath } from '../../_shared/live.js';

export async function onRequestPost({ request, env }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN'], 'DELETE');
  if (misconfigured) return misconfigured;

  const body = await readBody(request);
  if (!body || !(await tokenOk(body.token, env.LIVE_POST_TOKEN))) return forbidden();

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 300) return json({ error: 'id required' }, 400);

  try {
    const look = await fetch(API_BASE + '/resources/image/upload/' + idPath(id), {
      headers: { Authorization: basicAuth(env) }
    });
    if (look.status === 404) return json({ error: 'not found' }, 404);
    if (!look.ok) throw new Error('lookup ' + look.status);
    const asset = await look.json();
    if (!Array.isArray(asset.tags) || !asset.tags.includes(LIVE_TAG)) {
      console.log('live delete refused, not a Live post:', id);
      return json({ error: 'not found' }, 404);
    }

    const params = { public_id: id, timestamp: String(Math.floor(Date.now() / 1000)), invalidate: 'true' };
    const form = new URLSearchParams({
      ...params,
      api_key: env.CLOUDINARY_API_KEY,
      signature: await cloudinarySignature(params, env.CLOUDINARY_API_SECRET)
    });
    const resp = await fetch(API_BASE + '/image/destroy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const result = resp.ok ? await resp.json() : null;
    // "not found" here means it vanished between lookup and destroy: done either way.
    if (!result || (result.result !== 'ok' && result.result !== 'not found')) {
      throw new Error('destroy ' + resp.status + ' ' + JSON.stringify(result));
    }
  } catch (err) {
    console.error('LIVE DELETE failed for ' + id + ':', err.message);
    return json({ error: 'delete failed' }, 502);
  }
  return json({ ok: true });
}
