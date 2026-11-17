// The Blue River Live paging machinery, shared by the public feed
// (functions/api/live/feed.js) and the crew's management list
// (functions/api/live/list.js). Exports no onRequest handler, so Pages never
// turns this file into a route.
//
//   post shape: { id, photos: [{ id, w, h, thumb, full }], count, town,
//                 taken_at|null, posted_at, comment|null }
//               (+ hidden: boolean when built with { withHidden: true })
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
// n (posts per page) defaults to 24, max 48 (see parseN). Fields are copied from a
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
// Hidden posts. A post is hidden when ANY of its photos carries context
// hidden="1" (/api/live/update writes it on all of them; judging by any one
// means a half-finished write still hides). The public feed drops hidden
// posts — they don't count toward n — and the list shows them with
// hidden: true. A hidden batch read past a page's boundary goes into the
// cursor's skip list like a shown one, so a tail of photos that happen not to
// carry the flag can never surface on the next page as a post of its own.
import { DELIVERY_BASE, API_BASE, LIVE_TAG, basicAuth, idPath } from './live.js';

export const DEFAULT_N = 24;
export const MAX_N = 48;
const MAX_PHOTOS = 20;
const WINDOW = 100; // assets per Cloudinary search call; fixed, cursors depend on it
const MAX_CALLS = 6; // per feed request
const MAX_SKIP = 8; // shown (or hidden) batches carried in a cursor
const THUMB = 'c_limit,w_500,f_auto,q_auto';
const FULL = 'c_limit,w_2000,f_auto,q_auto';
const CURSOR_CHARS = /^[A-Za-z0-9_-]{1,1500}$/;

export function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function contextOf(r) {
  return (r.context && typeof r.context === 'object' && (r.context.custom || r.context)) || {};
}

// Batch members share a key; anything else is its own post. Prefixes keep a
// batch id from ever colliding with a public_id.
export function groupKey(r) {
  const batch = text(contextOf(r).batch);
  return batch && batch.length <= 100 ? 'b:' + batch : 'a:' + r.public_id;
}

function photo(r) {
  const path = 'v' + r.version + '/' + idPath(r.public_id);
  return { id: r.public_id, w: r.width, h: r.height, thumb: DELIVERY_BASE + THUMB + '/' + path, full: DELIVERY_BASE + FULL + '/' + path };
}

const uploaded = (r) => r.uploaded_at || r.created_at;

export const isHidden = (r) => text(contextOf(r).hidden) === '1';

// assets: one post's assets, newest first (search order).
function post(key, assets, hidden) {
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
    comment: first('comment'),
    ...(hidden === undefined ? {} : { hidden })
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

// n from a query/body value: default 24, capped at 48.
export function parseN(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) n = DEFAULT_N;
  return Math.min(n, MAX_N);
}

// '' or absent -> the first page; a valid cursor -> its state; else null.
export function parseCursor(raw) {
  return raw ? decodeCursor(raw) : { c: '', o: 0, a: '', x: [] };
}

// One page of posts. withHidden false (public feed): hidden posts are left
// out and don't count toward n. withHidden true (crew list): they're kept,
// and every post carries hidden: boolean.
export async function buildPage(env, n, start, { withHidden = false } = {}) {
  const skip = new Set(start.x);
  const read = []; // { r, key, c, o } in search order
  const groups = new Map(); // key -> assets, insertion = newest-first post order
  const hiddenKeys = new Set();
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
      if (isHidden(r)) hiddenKeys.add(key);
      if (skip.has(key)) return;
      if (!withHidden && hiddenKeys.has(key)) { groups.delete(key); return; }
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

  const posts = shown.map((k) => post(k, groups.get(k), withHidden ? hiddenKeys.has(k) : undefined));
  let next = null;
  if (boundary) {
    const from = boundary.at !== undefined ? boundary.at : read.indexOf(boundary);
    const done = new Set([...skip, ...shown]);
    // Hidden posts left out of this page go last: a shown post re-appearing
    // would be a duplicate, a hidden one's unflagged tail only a fallback.
    const leftOut = withHidden ? [] : [...hiddenKeys].filter((k) => !done.has(k));
    const later = new Set(read.slice(from).map((e) => e.key).filter((k) => done.has(k)));
    if (boundary.at !== undefined) shown.forEach((k) => later.add(k)); // its unread tail
    read.slice(from).map((e) => e.key).filter((k) => leftOut.includes(k)).forEach((k) => later.add(k));
    if (boundary.at !== undefined) leftOut.forEach((k) => later.add(k));
    const anchor = boundary.r ? boundary.r.public_id : boundary.a;
    next = encodeCursor({ c: boundary.c, o: boundary.o, a: anchor, x: [...later].slice(0, MAX_SKIP) });
  }
  return { posts, next };
}

