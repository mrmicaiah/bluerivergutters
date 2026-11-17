// POST /api/live/update — the crew edits or hides one Blue River Live post.
//
//   in:  { token, id, comment?, town?, hidden? }
//   out: { ok: true, photos: <how many photos were updated>,
//          public_within_seconds: 60 }
//
// id is a post id as /api/live/feed and /api/live/list give it: a batch id,
// or a legacy post's public_id. (A photo's public_id inside a batch also
// works and means its whole batch.) Only the fields present change, on EVERY
// photo of the post:
//   comment  string, at most 300 characters after trimming; "" removes it
//   town     one of the service-area towns (src/_data/serviceArea.js),
//            exactly as spelled there; "" removes it
//   hidden   true -> context hidden="1"; false -> the key is removed.
//            Hidden posts drop out of the public feed; /api/live/list keeps
//            them, flagged.
// Every other context key (batch, taken_at and the private gps) is kept.
//
// The public feed is cached ~60s, so a change shows on the site within a
// minute (public_within_seconds); /api/live/list shows it at once.
//
// Refusals: bad token -> the same 403 after ~1s as /api/live/sign; a field
// that isn't valid -> 400 naming why (only a valid token gets that far); an id
// matching no brg-live asset -> 404 (the token never reaches the site's other
// Cloudinary images); Cloudinary failing -> 502 (some photos may already be
// updated: the feed hides a post when ANY photo is hidden, and repeating the
// same call is safe).
//
// Photos and videos alike (each written through its own resource type).
// Cloudinary: the batch is found with one Search; each photo then gets one
// Admin API update carrying its WHOLE context, read-modify-write, because
// that call replaces an asset's context rather than merging into it (which
// is also what lets a key be removed).
import serviceArea from '../../../src/_data/serviceArea.js';
import { API_BASE, LIVE_TAG, LIVE_EXPRESSION, json, missingEnv, tokenOk, forbidden, readBody, basicAuth, idPath, lookupLive, typeOf } from '../../_shared/live.js';
import { contextOf, groupKey } from '../../_shared/feed.js';

const MAX_COMMENT = 300;
const FIELDS = ['token', 'id', 'comment', 'town', 'hidden'];
const BATCH_ID = /^[A-Za-z0-9_-]{1,100}$/; // what the post page mints; safe inside a search expression
const PUBLIC_SECONDS = 60; // functions/api/live/feed.js CACHE_SECONDS
const PARALLEL = 5;

// The towns the post page offers: every city serviceArea names.
const TOWNS = new Set([...Object.values(serviceArea.prefixes), ...Object.values(serviceArea.zips)]);

function problem(body) {
  const unknown = Object.keys(body).filter((k) => !FIELDS.includes(k));
  if (unknown.length) return 'fields not allowed: ' + unknown.join(', ');
  if (typeof body.id !== 'string' || !body.id.trim() || body.id.length > 300) return 'id required';
  if (!['comment', 'town', 'hidden'].some((k) => k in body)) return 'nothing to change: give comment, town or hidden';
  if ('comment' in body) {
    if (typeof body.comment !== 'string') return 'comment must be a string';
    if ([...body.comment.trim()].length > MAX_COMMENT) return 'comment must be at most ' + MAX_COMMENT + ' characters';
  }
  if ('town' in body && !(body.town === '' || (typeof body.town === 'string' && TOWNS.has(body.town)))) {
    return 'town must be one of the service-area towns, or ""';
  }
  if ('hidden' in body && typeof body.hidden !== 'boolean') return 'hidden must be true or false';
  return null;
}

// Cloudinary's context string: key=value|key=value, with = and | (and the
// backslash itself) escaped by a backslash.
const esc = (v) => String(v).replace(/([\\|=])/g, '\\$1');
const contextString = (ctx) => Object.entries(ctx).map(([k, v]) => esc(k) + '=' + esc(v)).join('|');

async function cloudinary(env, path, init = {}) {
  const resp = await fetch(API_BASE + path, { ...init, headers: { Authorization: basicAuth(env), ...(init.headers || {}) } });
  return resp;
}

async function batchAssets(env, batch) {
  const found = [];
  let cursor;
  for (let calls = 0; calls < 10; calls++) {
    const query = {
      expression: LIVE_EXPRESSION + ' AND context.batch="' + batch + '"',
      max_results: 500,
      with_field: ['context', 'tags']
    };
    if (cursor) query.next_cursor = cursor;
    const resp = await cloudinary(env, '/resources/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    if (!resp.ok) throw new Error('search ' + resp.status);
    const data = await resp.json();
    // Belt and braces: exact batch match, Live tag present.
    for (const r of data.resources || []) {
      if (contextOf(r).batch === batch && Array.isArray(r.tags) && r.tags.includes(LIVE_TAG)) found.push(r);
    }
    if (!data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return found;
}

// The post's photos (with their context), or [] when the id is no Live post.
async function postAssets(env, id) {
  if (BATCH_ID.test(id)) {
    const inBatch = await batchAssets(env, id);
    if (inBatch.length) return inBatch;
  }
  const asset = await lookupLive(env, id);
  if (!asset) return [];
  const key = groupKey(asset);
  return key.startsWith('b:') ? batchAssets(env, key.slice(2)) : [asset];
}

function changed(ctx, body) {
  const next = { ...ctx };
  const set = (k, v) => { if (v) next[k] = v; else delete next[k]; };
  if ('comment' in body) set('comment', body.comment.trim());
  if ('town' in body) set('town', body.town);
  if ('hidden' in body) set('hidden', body.hidden ? '1' : '');
  return next;
}

async function write(env, asset, body) {
  const ctx = {};
  for (const [k, v] of Object.entries(contextOf(asset))) if (typeof v === 'string') ctx[k] = v;
  const form = new URLSearchParams({ context: contextString(changed(ctx, body)) });
  const resp = await cloudinary(env, '/resources/' + typeOf(asset) + '/upload/' + idPath(asset.public_id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  if (!resp.ok) throw new Error('update ' + asset.public_id + ' ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
}

export async function onRequestPost({ request, env }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN'], 'UPDATE');
  if (misconfigured) return misconfigured;

  const body = await readBody(request);
  if (!body || !(await tokenOk(body.token, env.LIVE_POST_TOKEN))) return forbidden();

  const reason = problem(body);
  if (reason) return json({ error: reason }, 400);
  const id = body.id.trim();

  let assets;
  try {
    assets = await postAssets(env, id);
    if (!assets.length) return json({ error: 'not found' }, 404);
    for (let i = 0; i < assets.length; i += PARALLEL) {
      await Promise.all(assets.slice(i, i + PARALLEL).map((a) => write(env, a, body)));
    }
  } catch (err) {
    console.error('LIVE UPDATE failed for ' + id + ':', err.message);
    return json({ error: 'update failed' }, 502);
  }
  return json({ ok: true, photos: assets.length, public_within_seconds: PUBLIC_SECONDS });
}
