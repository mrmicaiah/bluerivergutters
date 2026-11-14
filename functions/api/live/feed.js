// GET /api/live/feed?cursor&n — the public Blue River Live feed, newest first.
//
//   out: { posts: [{ id, photos: [{ id, w, h, thumb, full }], count, town,
//                    taken_at|null, posted_at, comment|null }],
//          next: cursor|null }
//
// A post is one Post action on /live/post/: every asset whose context carries
// the same `batch` id. Assets without one (uploaded before batches existed)
// are posts of their own, id = their public_id.
//   id         the batch id, or the lone asset's public_id
//   photos     in upload order, capped at MAX_PHOTOS (the rest are dropped,
//              never shown as a post of their own); count = photos.length
//   posted_at  the batch's earliest upload
//   taken_at   the earliest non-null taken_at in the batch, else null
//   town, comment  from the first photo (upload order) carrying one
//
// n (posts per page) defaults to 24, max 48. Fields are copied from a
// whitelist, so Cloudinary's gps context can never reach the response.
//
// Paging. Cloudinary returns assets, not posts, so this reads fixed-size
// search windows (WINDOW assets, uploaded_at desc) until it has seen the
// first photo of post n+1: posts 1..n are then complete and a batch is never
// split across feed pages, even when it straddles a search window. `next`
// points at that first photo of post n+1 — the search cursor of its window,
// its offset there, and its public_id (the anchor: if new uploads have pushed
// the top window down since, the next page finds the photo by id rather than
// trusting the offset) — and lists any batches already shown whose photos
// were read past that point, so the next page skips them. One assumption:
// a batch's photos are uploaded together, so another post's photos don't
// fall between them by more than what one read covers.
//
// Every page's banner calls this, so answers are cached 60s per (n, cursor)
// in caches.default — that keeps Cloudinary's Admin API quota and latency
// sane. A new upload therefore shows within ~60s; there's no purge hook.
// (caches.default only stores on the custom domain, not on *.pages.dev.)
import { DELIVERY_BASE, API_BASE, LIVE_TAG, json, missingEnv, basicAuth, idPath } from '../../_shared/live.js';

const DEFAULT_N = 24;
const MAX_N = 48;
const MAX_PHOTOS = 20;
const WINDOW = 100; // assets per Cloudinary search call; fixed, cursors depend on it
const MAX_CALLS = 6; // per feed request
const MAX_SKIP = 8; // shown batches carried in a cursor
const CACHE_SECONDS = 60;
const THUMB = 'c_limit,w_500,f_auto,q_auto';
const FULL = 'c_limit,w_2000,f_auto,q_auto';
const CURSOR_CHARS = /^[A-Za-z0-9_-]{1,1500}$/;

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function contextOf(r) {
  return (r.context && typeof r.context === 'object' && (r.context.custom || r.context)) || {};
}

// Batch members share a key; anything else is its own post. Prefixes keep a
// batch id from ever colliding with a public_id.
function groupKey(r) {
  const batch = text(contextOf(r).batch);
  return batch && batch.length <= 100 ? 'b:' + batch : 'a:' + r.public_id;
}

function photo(r) {
  const path = 'v' + r.version + '/' + idPath(r.public_id);
  return { id: r.public_id, w: r.width, h: r.height, thumb: DELIVERY_BASE + THUMB + '/' + path, full: DELIVERY_BASE + FULL + '/' + path };
}

const uploaded = (r) => r.uploaded_at || r.created_at;

// assets: one post's assets, newest first (search order).
function post(key, assets) {
  const ordered = assets.slice().reverse().slice(0, MAX_PHOTOS);
  const ctxs = ordered.map(contextOf);
  const first = (k) => ctxs.map((c) => text(c[k])).find(Boolean) || null;
  let taken = null;
  for (const c of ctxs) {
    const t = text(c.taken_at);
    const ms = t ? Date.parse(t) : NaN;
    if (!Number.isNaN(ms) && (!taken || ms < taken.ms)) taken = { t, ms };
  }
  const photos = ordered.map(photo);
  return {
    id: key.slice(2),
    photos,
    count: photos.length,
    town: first('town') || '',
    taken_at: taken ? taken.t : null,
    posted_at: uploaded(ordered[0]),
    comment: first('comment')
  };
}

// Cursor: base64url JSON { c: search cursor of the window ('' = first),
// o: offset in that window, a: public_id found there, x: group keys to skip }.
function encodeCursor(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw) {
  if (!CURSOR_CHARS.test(raw)) return null;
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    const ok = s && typeof s.c === 'string' && s.c.length <= 1000 &&
      Number.isInteger(s.o) && s.o >= 0 && s.o < WINDOW &&
      typeof s.a === 'string' && s.a.length <= 300 &&
      Array.isArray(s.x) && s.x.length <= MAX_SKIP && s.x.every((k) => typeof k === 'string' && k.length <= 110);
    return ok ? { c: s.c, o: s.o, a: s.a, x: s.x } : null;
  } catch {
    return null;
  }
}

async function search(env, cursor) {
  const query = {
    expression: 'resource_type:image AND tags=' + LIVE_TAG,
    sort_by: [{ uploaded_at: 'desc' }],
    max_results: WINDOW,
    with_field: ['context']
  };
  if (cursor) query.next_cursor = cursor;
  const resp = await fetch(API_BASE + '/resources/search', {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  if (!resp.ok) throw new Error('Cloudinary search ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  return resp.json();
}

async function buildPage(env, n, start) {
  const skip = new Set(start.x);
  const read = []; // { r, key, c, o } in search order
  const groups = new Map(); // key -> assets, insertion = newest-first post order
  let windowCursor = start.c;
  let more = true;
  for (let calls = 0; calls < MAX_CALLS; calls++) {
    const data = await search(env, windowCursor);
    const resources = data.resources || [];
    let from = 0;
    if (calls === 0) {
      const anchored = start.a ? resources.findIndex((r) => r.public_id === start.a) : -1;
      from = anchored >= 0 ? anchored : start.o;
    }
    resources.forEach((r, o) => {
      if (o < from) return;
      const key = groupKey(r);
      read.push({ r, key, c: windowCursor, o });
      if (skip.has(key)) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    if (!data.next_cursor) { more = false; break; }
    windowCursor = data.next_cursor;
    if (groups.size > n) break;
  }

  const keys = [...groups.keys()];
  let shown = keys.slice(0, n);
  let boundary = null; // first read entry of the first post not shown
  if (groups.size > n) {
    boundary = read.find((e) => e.key === keys[n]);
  } else if (more) {
    // Ran out of calls before post n+1 began: the last post may be cut off,
    // so hold it for the next page — unless it's the only one.
    if (keys.length > 1) {
      shown = keys.slice(0, -1);
      boundary = read.find((e) => e.key === keys[keys.length - 1]);
    } else {
      boundary = { c: windowCursor, o: 0, a: '', at: read.length };
    }
  }

  const posts = shown.map((k) => post(k, groups.get(k)));
  let next = null;
  if (boundary) {
    const from = boundary.at !== undefined ? boundary.at : read.indexOf(boundary);
    const hidden = new Set([...skip, ...shown]);
    const later = new Set(read.slice(from).map((e) => e.key).filter((k) => hidden.has(k)));
    if (boundary.at !== undefined) shown.forEach((k) => later.add(k)); // its unread tail
    const anchor = boundary.r ? boundary.r.public_id : boundary.a;
    next = encodeCursor({ c: boundary.c, o: boundary.o, a: anchor, x: [...later].slice(0, MAX_SKIP) });
  }
  return { posts, next };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'FEED');
  if (misconfigured) return misconfigured;

  const url = new URL(request.url);
  let n = parseInt(url.searchParams.get('n'), 10);
  if (!Number.isFinite(n) || n < 1) n = DEFAULT_N;
  n = Math.min(n, MAX_N);
  const rawCursor = url.searchParams.get('cursor') || '';
  const start = rawCursor ? decodeCursor(rawCursor) : { c: '', o: 0, a: '', x: [] };
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
