// POST /api/live/list — the crew's management view of Blue River Live.
//
//   in:  { token, cursor?, n? }
//   out: { posts: [ ...the public feed's post shape..., hidden: boolean ],
//          next: cursor|null }
//   Video entries also carry overlong: boolean (true = longer than 31s, or
//   no duration reported: the public feed leaves that file out).
//
// The same posts, order (newest first), grouping and cursors as
// /api/live/feed (functions/_shared/feed.js), but INCLUDING hidden posts, each
// flagged. Token-gated like the other crew endpoints (bad token -> the same
// 403 after ~1s), and never cached anywhere: Cache-Control private, no-store.
// The list reads Cloudinary directly, so it reflects an /api/live/update at
// once; the public feed takes up to ~60s (its cache).
import { json, missingEnv, tokenOk, forbidden, readBody } from '../../_shared/live.js';
import { buildPage, parseN, parseCursor } from '../../_shared/feed.js';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export async function onRequestPost({ request, env }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN'], 'LIST');
  if (misconfigured) return misconfigured;

  const body = await readBody(request);
  if (!body || !(await tokenOk(body.token, env.LIVE_POST_TOKEN))) return forbidden();

  const n = parseN(body.n);
  const start = typeof body.cursor === 'string' || body.cursor === undefined || body.cursor === null
    ? parseCursor(body.cursor || '')
    : null;
  if (!start) return json({ error: 'bad cursor' }, 400, PRIVATE);

  try {
    return json(await buildPage(env, n, start, { manage: true }), 200, PRIVATE);
  } catch (err) {
    console.error('LIVE LIST unavailable:', err.message);
    return json({ posts: [], next: null, error: 'list unavailable' }, 502, PRIVATE);
  }
}
