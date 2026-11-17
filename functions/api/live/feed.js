// GET /api/live/feed?cursor&n — the public Blue River Live feed, newest first.
//
//   out: { posts: [{ id, photos: [{ id, w, h, thumb, full }], count, town,
//                    taken_at|null, posted_at, comment|null }],
//          next: cursor|null }
//
// Posts, grouping and paging are built in functions/_shared/feed.js (shared
// with the crew's /api/live/list); see there for the rules. This endpoint
// leaves hidden posts out: a batch where any photo carries hidden="1".
//
// Every page's banner calls this, so answers are cached 60s per (n, cursor)
// in caches.default — that keeps Cloudinary's Admin API quota and latency
// sane. A new upload, and an edit or hide/unhide made through
// /api/live/update, therefore shows on the site within ~60s; there's no purge
// hook. (caches.default only stores on the custom domain, not on *.pages.dev.)
import { json, missingEnv } from '../../_shared/live.js';
import { buildPage, parseN, parseCursor } from '../../_shared/feed.js';

const CACHE_SECONDS = 60;

export async function onRequestGet({ request, env, waitUntil }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'FEED');
  if (misconfigured) return misconfigured;

  const url = new URL(request.url);
  const n = parseN(url.searchParams.get('n'));
  const rawCursor = url.searchParams.get('cursor') || '';
  const start = parseCursor(rawCursor);
  if (!start) return json({ error: 'bad cursor' }, 400);

  // One key per page, however the query string was written.
  const cacheKey = new Request(url.origin + '/api/live/feed?n=' + n + (rawCursor ? '&cursor=' + rawCursor : ''));
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let body;
  try {
    body = await buildPage(env, n, start);
  } catch (err) {
    console.error('LIVE FEED unavailable:', err.message);
    return json({ posts: [], next: null, error: 'feed unavailable' }, 502);
  }

  const response = json(body, 200, { 'Cache-Control': 'public, max-age=' + CACHE_SECONDS });
  if (cache) waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
