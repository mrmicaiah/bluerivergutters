// GET /api/live/feed?cursor&n — the public Blue River Live feed, newest first.
//
//   out: { posts: [{ id, w, h, thumb, full, town, taken_at|null, posted_at, comment|null }],
//          next: cursor|null }
//
// n defaults to 24, max 48. Posts are built field by field from a whitelist,
// so Cloudinary's gps context (and anything else it returns) can never reach
// the response.
//
// Every page's banner calls this, so answers are cached 60s per (n, cursor)
// in caches.default — that keeps Cloudinary's Admin API quota and latency
// sane. A new upload therefore shows within ~60s; there's no purge hook.
// (caches.default only stores on the custom domain, not on *.pages.dev.)
import { DELIVERY_BASE, API_BASE, LIVE_TAG, json, missingEnv, basicAuth, idPath } from '../../_shared/live.js';

const DEFAULT_N = 24;
const MAX_N = 48;
const CACHE_SECONDS = 60;
const THUMB = 'c_limit,w_500,f_auto,q_auto';
const FULL = 'c_limit,w_2000,f_auto,q_auto';
const CURSOR = /^[A-Za-z0-9_\-=+/.]{1,512}$/;

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function post(r) {
  const ctx = (r.context && typeof r.context === 'object' && (r.context.custom || r.context)) || {};
  const path = 'v' + r.version + '/' + idPath(r.public_id);
  return {
    id: r.public_id,
    w: r.width,
    h: r.height,
    thumb: DELIVERY_BASE + THUMB + '/' + path,
    full: DELIVERY_BASE + FULL + '/' + path,
    town: text(ctx.town) || '',
    taken_at: text(ctx.taken_at),
    posted_at: r.uploaded_at || r.created_at,
    comment: text(ctx.comment)
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'FEED');
  if (misconfigured) return misconfigured;

  const url = new URL(request.url);
  let n = parseInt(url.searchParams.get('n'), 10);
  if (!Number.isFinite(n) || n < 1) n = DEFAULT_N;
  n = Math.min(n, MAX_N);
  const cursor = url.searchParams.get('cursor') || '';
  if (cursor && !CURSOR.test(cursor)) return json({ error: 'bad cursor' }, 400);

  // One key per page, however the query string was written.
  const cacheKey = new Request(url.origin + '/api/live/feed?n=' + n + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const query = {
    expression: 'resource_type:image AND tags=' + LIVE_TAG,
    sort_by: [{ uploaded_at: 'desc' }],
    max_results: n,
    with_field: ['context']
  };
  if (cursor) query.next_cursor = cursor;

  let data;
  try {
    const resp = await fetch(API_BASE + '/resources/search', {
      method: 'POST',
      headers: { Authorization: basicAuth(env), 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    if (!resp.ok) throw new Error('Cloudinary search ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
    data = await resp.json();
  } catch (err) {
    console.error('LIVE FEED unavailable:', err.message);
    return json({ posts: [], next: null, error: 'feed unavailable' }, 502);
  }

  const body = {
    posts: (data.resources || []).map(post),
    next: data.next_cursor || null
  };
  const response = json(body, 200, { 'Cache-Control': 'public, max-age=' + CACHE_SECONDS });
  if (cache) waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
