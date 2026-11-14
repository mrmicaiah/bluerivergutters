// Blue River Live: POST /api/live/sign, GET /api/live/feed, POST /api/live/delete.
// Run: npm run test:functions
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { call, loadWorker, resetNet, resetCache, net, cache, callsTo, jsonResponse } from './harness.mjs';

const ENV = {
  CLOUDINARY_API_KEY: 'test-key-123',
  CLOUDINARY_API_SECRET: 'test-secret-abc',
  LIVE_POST_TOKEN: 'crew-token-correct-horse'
};
const TRANSFORMATION = 'c_limit,w_2000,h_2000,q_auto:good';
const now = () => Math.floor(Date.now() / 1000);

// Independent re-implementation of Cloudinary's signing rule, to check the
// endpoint against: sorted key=value pairs joined by &, secret appended, SHA-1.
function expectedSignature(params, secret) {
  const s = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('&');
  return createHash('sha1').update(s + secret).digest('hex');
}

function goodParams(over = {}) {
  return {
    timestamp: now(),
    folder: 'live/',
    tags: 'brg-live',
    context: 'town=Madison|taken_at=2026-11-14T10:02:00Z|comment=New 6-inch seamless|gps=34.6993,-86.7483',
    transformation: TRANSFORMATION,
    ...over
  };
}

beforeEach(() => {
  resetNet();
  resetCache();
});

// ---- routing ------------------------------------------------------------

test('generated _routes.json covers /api/live/* alongside /geo.json and /api/lead', async () => {
  const { routes } = await loadWorker();
  for (const r of ['/geo.json', '/api/lead', '/api/live/sign', '/api/live/feed', '/api/live/delete']) {
    assert.ok(routes.include.includes(r), r + ' missing from generated routes: ' + JSON.stringify(routes.include));
  }
  for (const r of routes.include) assert.ok(!r.includes('_shared'), 'helper module became a route: ' + r);
});

// ---- sign ---------------------------------------------------------------

test('sign: valid token -> Cloudinary signature over exactly the given params', async () => {
  const p = goodParams();
  const r = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, params_to_sign: p } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ['api_key', 'cloud_name', 'signature', 'timestamp']);
  assert.equal(r.json.api_key, ENV.CLOUDINARY_API_KEY);
  assert.equal(r.json.cloud_name, 'dxzw1zwez');
  assert.equal(r.json.timestamp, p.timestamp);
  assert.equal(r.json.signature, expectedSignature(p, ENV.CLOUDINARY_API_SECRET));
  assert.ok(!r.text.includes(ENV.CLOUDINARY_API_SECRET), 'secret leaked');
  assert.equal(net.calls.length, 0, 'signing needs no network');
});

test('sign: transformation components in any order, folder "live", extra tags all accepted', async () => {
  const p = goodParams({ folder: 'live', tags: 'brg-live,crew', transformation: 'q_auto:good,w_2000,c_limit,h_2000' });
  const r = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, params_to_sign: p } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.signature, expectedSignature(p, ENV.CLOUDINARY_API_SECRET));
});

test('sign: no timestamp given -> server supplies one and signs it', async () => {
  const p = goodParams();
  delete p.timestamp;
  const r = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, params_to_sign: p } });
  assert.equal(r.status, 200, r.text);
  assert.ok(Math.abs(r.json.timestamp - now()) <= 5);
  assert.equal(r.json.signature, expectedSignature({ ...p, timestamp: r.json.timestamp }, ENV.CLOUDINARY_API_SECRET));
});

test('sign: wrong token -> 403 after ~1s, body says nothing about why', async () => {
  const bodies = [
    { token: 'crew-token-correct-hors', params_to_sign: goodParams() },
    { token: '', params_to_sign: goodParams() },
    { params_to_sign: goodParams() }
  ];
  const texts = new Set();
  for (const body of bodies) {
    const t0 = Date.now();
    const r = await call('/api/live/sign', { method: 'POST', env: ENV, body });
    const took = Date.now() - t0;
    assert.equal(r.status, 403);
    assert.ok(took >= 900, 'bad token answered in ' + took + 'ms');
    assert.ok(!r.json.signature);
    texts.add(r.text);
  }
  const t0 = Date.now();
  const nonJson = await call('/api/live/sign', { method: 'POST', env: ENV, rawBody: 'not json' });
  assert.equal(nonJson.status, 403);
  assert.ok(Date.now() - t0 >= 900);
  texts.add(nonJson.text);
  assert.equal(texts.size, 1, 'every bad-token response must be identical');
  assert.ok(!/token|length|missing/i.test([...texts][0]));
});

test('sign: refuses without the display-size transformation (and other guardrails)', async () => {
  const cases = {
    'no transformation': (() => { const p = goodParams(); delete p.transformation; return p; })(),
    'transformation without c_limit': goodParams({ transformation: 'w_2000,h_2000,q_auto:good' }),
    'bigger size': goodParams({ transformation: 'c_limit,w_4000,h_4000,q_auto:good' }),
    'chained extra step': goodParams({ transformation: TRANSFORMATION + '/e_sepia' }),
    'wrong folder': goodParams({ folder: 'projects/' }),
    'no folder': (() => { const p = goodParams(); delete p.folder; return p; })(),
    'missing brg-live tag': goodParams({ tags: 'crew' }),
    'stale timestamp': goodParams({ timestamp: now() - 7200 }),
    'unknown param': goodParams({ notification_url: 'https://evil.example/hook' }),
    'non-string value': goodParams({ context: { town: 'Madison' } })
  };
  for (const [name, p] of Object.entries(cases)) {
    const r = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, params_to_sign: p } });
    assert.equal(r.status, 400, name + ' -> ' + r.status + ' ' + r.text);
    assert.ok(!r.json.signature, name + ' was signed');
    assert.ok(r.json.error, name + ' has no reason');
  }
});

// ---- feed ---------------------------------------------------------------

const SEARCH = 'api.cloudinary.com/v1_1/dxzw1zwez/resources/search';
const GPS = '34.6993,-86.7483';
const BASE_T = Date.parse('2026-11-14T15:00:00Z');

// One Cloudinary asset. `t` = seconds after BASE_T it was uploaded.
function asset(name, t, ctx = {}) {
  const at = new Date(BASE_T + t * 1000).toISOString().replace('.000Z', 'Z');
  return {
    asset_id: 'a-' + name,
    public_id: 'live/' + name,
    version: 1794600000 + t,
    format: 'jpg',
    width: 2000,
    height: 1500,
    created_at: at,
    uploaded_at: at,
    tags: ['brg-live'],
    context: { gps: GPS, ...ctx }
  };
}

// A fake Cloudinary Search over `assets` (a live array: tests may add
// uploads between calls). Sorts by uploaded_at desc and pages with keyset
// cursors — the cursor names the next window's first asset, so new uploads at
// the top don't shift later windows, as with the real API. Honors max_results.
function fakeCloudinary(assets) {
  const sorted = () => [...assets].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at) || b.public_id.localeCompare(a.public_id));
  resetNet([{
    match: (url) => url.includes(SEARCH),
    reply: (url, init) => {
      const q = JSON.parse(init.body);
      const all = sorted();
      const start = q.next_cursor ? all.findIndex((r) => 'cur:' + r.public_id === q.next_cursor) : 0;
      assert.ok(start >= 0, 'stale fake cursor ' + q.next_cursor);
      const page = all.slice(start, start + q.max_results);
      const end = start + page.length;
      return jsonResponse({
        total_count: all.length,
        resources: page,
        ...(end < all.length ? { next_cursor: 'cur:' + all[end].public_id } : {})
      });
    }
  }]);
}

async function feed(query = '') {
  const r = await call('/api/live/feed' + query, { env: ENV });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

// Every page, following next, until next is null.
async function allPages(n) {
  const pages = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard++) {
    resetCache();
    const page = await feed('?n=' + n + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    pages.push(page);
    if (!page.next) return pages;
    cursor = page.next;
  }
  throw new Error('feed never ended');
}

const ids = (post) => post.photos.map((p) => p.id);

test('feed: post shape, photo URLs, nulls, and the Cloudinary search request', async () => {
  fakeCloudinary([
    asset('one', 10, { town: 'Madison', taken_at: '2026-11-14T10:02:00Z', comment: 'New 6-inch seamless' }),
    asset('two', 20, { custom: { town: 'Athens', gps: GPS } }) // Admin-API style context
  ]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ['next', 'posts']);
  assert.equal(r.json.next, null);
  const [a, b] = r.json.posts;
  assert.deepEqual(Object.keys(b).sort(), ['comment', 'count', 'id', 'photos', 'posted_at', 'taken_at', 'town']);
  assert.deepEqual(b, {
    id: 'live/one',
    photos: [{
      id: 'live/one', w: 2000, h: 1500,
      thumb: 'https://res.cloudinary.com/dxzw1zwez/image/upload/c_limit,w_500,f_auto,q_auto/v1794600010/live/one',
      full: 'https://res.cloudinary.com/dxzw1zwez/image/upload/c_limit,w_2000,f_auto,q_auto/v1794600010/live/one'
    }],
    count: 1,
    town: 'Madison', taken_at: '2026-11-14T10:02:00Z', posted_at: '2026-11-14T15:00:10Z', comment: 'New 6-inch seamless'
  });
  assert.equal(a.id, 'live/two', 'newest post first');
  assert.equal(a.town, 'Athens');
  assert.equal(a.taken_at, null);
  assert.equal(a.comment, null);

  const [s] = callsTo(SEARCH);
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.headers.Authorization, 'Basic ' + btoa(ENV.CLOUDINARY_API_KEY + ':' + ENV.CLOUDINARY_API_SECRET));
  const q = JSON.parse(s.init.body);
  assert.match(q.expression, /tags=brg-live/);
  assert.deepEqual(q.sort_by, [{ uploaded_at: 'desc' }]);
  assert.deepEqual(q.with_field, ['context']);
});

test('feed: two assets sharing a batch come back as ONE post with photos[2]', async () => {
  fakeCloudinary([
    asset('b1-first', 100, { batch: 'b1794681290000-a1f3', town: 'Madison', comment: 'Before and after' }),
    asset('b1-second', 101, { batch: 'b1794681290000-a1f3', town: 'Huntsville', taken_at: '2026-11-14T09:00:00Z' }),
    asset('legacy', 50, { town: 'Decatur' })
  ]);
  const { posts } = await feed();
  assert.equal(posts.length, 2);
  const [batch, legacy] = posts;
  assert.equal(batch.id, 'b1794681290000-a1f3');
  assert.equal(batch.count, 2);
  assert.deepEqual(ids(batch), ['live/b1-first', 'live/b1-second'], 'photos in upload order');
  assert.equal(batch.posted_at, '2026-11-14T15:01:40Z', 'earliest upload');
  assert.equal(batch.taken_at, '2026-11-14T09:00:00Z', 'earliest non-null taken_at');
  assert.equal(batch.town, 'Madison', 'town from the first asset carrying one');
  assert.equal(batch.comment, 'Before and after');
  assert.deepEqual(Object.keys(batch.photos[0]).sort(), ['full', 'h', 'id', 'thumb', 'w']);
  assert.equal(legacy.id, 'live/legacy');
  assert.equal(legacy.count, 1);
});

test('feed: taken_at is the EARLIEST non-null in the batch, whatever order they uploaded', async () => {
  fakeCloudinary([
    asset('p1', 1, { batch: 'bX', town: 'Athens', taken_at: '2026-11-14T11:00:00Z' }),
    asset('p2', 2, { batch: 'bX', taken_at: '2026-11-14T08:30:00-06:00' }), // 14:30Z, later
    asset('p3', 3, { batch: 'bX', taken_at: '2026-11-14T10:15:00Z' })
  ]);
  const { posts } = await feed();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].taken_at, '2026-11-14T10:15:00Z');
});

test('feed: batch of one renders as count 1 with the batch id', async () => {
  fakeCloudinary([asset('solo', 5, { batch: 'b1794681290000-0001', town: 'Athens' })]);
  const { posts } = await feed();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'b1794681290000-0001');
  assert.equal(posts[0].count, 1);
  assert.deepEqual(ids(posts[0]), ['live/solo']);
});

test('feed: legacy assets without batch stay singleton posts', async () => {
  fakeCloudinary([asset('old1', 1, { town: 'A' }), asset('old2', 2, { town: 'B' }), asset('old3', 3, { town: 'C' })]);
  const { posts } = await feed();
  assert.deepEqual(posts.map((p) => [p.id, p.count]), [['live/old3', 1], ['live/old2', 1], ['live/old1', 1]]);
});

test('feed: a batch straddling the feed-page boundary is never split', async () => {
  // Newest first: batch C (3 photos), batch B (4 photos), legacy L, batch A (2).
  fakeCloudinary([
    asset('a1', 10, { batch: 'bA', town: 'T' }), asset('a2', 11, { batch: 'bA' }),
    asset('L', 20, { town: 'T' }),
    asset('b1', 30, { batch: 'bB', town: 'T' }), asset('b2', 31, { batch: 'bB' }), asset('b3', 32, { batch: 'bB' }), asset('b4', 33, { batch: 'bB' }),
    asset('c1', 40, { batch: 'bC', town: 'T' }), asset('c2', 41, { batch: 'bC' }), asset('c3', 42, { batch: 'bC' })
  ]);
  const p1 = await feed('?n=1');
  assert.deepEqual(p1.posts.map((p) => [p.id, p.count]), [['bC', 3]]);
  assert.ok(p1.next);
  resetCache();
  const p2 = await feed('?n=1&cursor=' + encodeURIComponent(p1.next));
  assert.deepEqual(p2.posts.map((p) => [p.id, p.count]), [['bB', 4]]);
  assert.deepEqual(ids(p2.posts[0]), ['live/b1', 'live/b2', 'live/b3', 'live/b4']);
  resetCache();
  const p3 = await feed('?n=2&cursor=' + encodeURIComponent(p2.next));
  assert.deepEqual(p3.posts.map((p) => [p.id, p.count]), [['live/L', 1], ['bA', 2]]);
  assert.equal(p3.next, null);
});

test('feed: a batch straddling a Cloudinary search page is fetched whole, then paging resumes cleanly', async () => {
  // 150 legacy singles newest, then a 6-photo batch, then 60 more singles:
  // whatever window size the endpoint reads, some batch sits on a boundary
  // for some n. Walk every n from 1..48's interesting values and check that
  // every asset appears exactly once and no batch appears on two pages.
  const assets = [];
  for (let i = 0; i < 60; i++) assets.push(asset('old' + i, 1000 + i, { town: 'T' }));
  for (let i = 0; i < 6; i++) assets.push(asset('mid' + i, 2000 + i, { batch: 'bMID', town: 'T' }));
  for (let i = 0; i < 150; i++) assets.push(asset('new' + i, 3000 + i, i % 7 === 0 ? { batch: 'bN' + Math.floor(i / 7), town: 'T' } : { batch: 'bN' + Math.floor(i / 7) }));
  fakeCloudinary(assets);

  for (const n of [1, 5, 7, 22, 24, 48]) {
    const pages = await allPages(n);
    const seenAssets = [];
    const seenPosts = new Set();
    for (const page of pages) {
      assert.ok(page.posts.length <= n, 'page longer than n=' + n);
      for (const post of page.posts) {
        assert.ok(!seenPosts.has(post.id), 'n=' + n + ': post ' + post.id + ' split across pages');
        seenPosts.add(post.id);
        assert.equal(post.count, post.photos.length);
        seenAssets.push(...ids(post));
      }
    }
    assert.equal(seenAssets.length, assets.length, 'n=' + n + ': lost or duplicated photos');
    assert.equal(new Set(seenAssets).size, assets.length);
    const mid = pages.flatMap((p) => p.posts).find((p) => p.id === 'bMID');
    assert.equal(mid.count, 6, 'n=' + n);
  }
});

test('feed: new uploads between page loads neither repeat nor drop posts on later pages', async () => {
  const assets = [];
  for (let i = 0; i < 4; i++) assets.push(asset('s' + i, 10 + i, { town: 'T' }));
  for (let i = 0; i < 3; i++) assets.push(asset('m' + i, 20 + i, { batch: 'bM', town: 'T' }));
  for (let i = 4; i < 8; i++) assets.push(asset('s' + i, 30 + i, { town: 'T' }));
  fakeCloudinary(assets);
  const p1 = await feed('?n=4');
  assert.deepEqual(p1.posts.map((p) => p.id), ['live/s7', 'live/s6', 'live/s5', 'live/s4']);
  // Five photos (two posts) land while the visitor reads page 1.
  for (let i = 0; i < 4; i++) assets.push(asset('fresh' + i, 100 + i, { batch: 'bFRESH', town: 'T' }));
  assets.push(asset('fresh-solo', 200, { town: 'T' }));
  resetCache();
  const p2 = await feed('?n=4&cursor=' + encodeURIComponent(p1.next));
  assert.deepEqual(p2.posts.map((p) => [p.id, p.count]), [['bM', 3], ['live/s3', 1], ['live/s2', 1], ['live/s1', 1]]);
  resetCache();
  const p3 = await feed('?n=4&cursor=' + encodeURIComponent(p2.next));
  assert.deepEqual(p3.posts.map((p) => p.id), ['live/s0']);
  assert.equal(p3.next, null);
});

test('feed: photos per post capped at 20; the extras never resurface as their own post', async () => {
  const assets = [asset('older', 1, { town: 'T' })];
  for (let i = 0; i < 25; i++) assets.push(asset('big' + String(i).padStart(2, '0'), 100 + i, { batch: 'bBIG', town: 'T' }));
  fakeCloudinary(assets);
  const p1 = await feed('?n=1');
  assert.equal(p1.posts[0].id, 'bBIG');
  assert.equal(p1.posts[0].count, 20);
  assert.equal(p1.posts[0].photos.length, 20);
  assert.equal(p1.posts[0].photos[0].id, 'live/big00', 'keeps the first 20 by upload order');
  resetCache();
  const p2 = await feed('?n=5&cursor=' + encodeURIComponent(p1.next));
  assert.deepEqual(p2.posts.map((p) => p.id), ['live/older']);
});

test('feed: GPS never leaves the server', async () => {
  fakeCloudinary([
    asset('g1', 1, { batch: 'bG', town: 'Madison', comment: 'c' }),
    asset('g2', 2, { batch: 'bG', custom: { town: 'Decatur', gps: '34.6059,-86.9833' } }),
    { ...asset('g3', 3, { town: 'Huntsville' }), metadata: { gps: GPS }, gps: GPS }
  ]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 200);
  assert.ok(!/gps/i.test(r.text), 'feed mentions gps: ' + r.text);
  assert.ok(!r.text.includes('34.6993') && !r.text.includes('-86.7483') && !r.text.includes('34.6059'), 'coordinates leaked: ' + r.text);
});

test('feed: n defaults to 24 and caps at 48 posts', async () => {
  const many = [];
  for (let i = 0; i < 80; i++) many.push(asset('s' + i, i, { town: 'T' }));
  fakeCloudinary(many);
  assert.equal((await feed()).posts.length, 24);
  resetCache();
  assert.equal((await feed('?n=500')).posts.length, 48);
  resetCache();
  assert.equal((await feed('?n=junk')).posts.length, 24);
  resetCache();
  assert.equal((await feed('?n=6')).posts.length, 6);
});

test('feed: cached ~60s via caches.default — second hit never reaches Cloudinary', async () => {
  fakeCloudinary([asset('c1', 1, { town: 'Madison' }), asset('c2', 2, { town: 'Madison' })]);
  const first = await call('/api/live/feed?n=1', { env: ENV });
  const searches = callsTo(SEARCH).length;
  assert.ok(searches >= 1);
  assert.equal(cache.puts.length, 1);
  assert.match(cache.puts[0].cacheControl, /max-age=60\b/);
  assert.match(first.headers.get('Cache-Control'), /max-age=60\b/);

  const second = await call('/api/live/feed?n=1', { env: ENV });
  assert.equal(callsTo(SEARCH).length, searches, 'second request went to Cloudinary');
  assert.equal(second.text, first.text);

  await call('/api/live/feed?n=1&cursor=' + encodeURIComponent(first.json.next), { env: ENV });
  assert.ok(callsTo(SEARCH).length > searches, 'another page is its own cache key');
});

test('feed: Cloudinary failure -> 502, empty feed, not cached', async () => {
  resetNet([{ match: (u) => u.includes(SEARCH), reply: () => new Response('rate limited', { status: 420 }) }]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 502);
  assert.deepEqual(r.json.posts, []);
  assert.equal(r.json.next, null);
  assert.equal(cache.store.size, 0);
});

test('feed: junk or forged cursor refused before touching Cloudinary or the cache', async () => {
  for (const c of ['<script>' + 'x'.repeat(600), 'not-a-real-cursor', btoa('{"c":5}')]) {
    resetNet();
    resetCache();
    const r = await call('/api/live/feed?cursor=' + encodeURIComponent(c), { env: ENV });
    assert.equal(r.status, 400, c);
    assert.equal(net.calls.length, 0);
    assert.equal(cache.puts.length, 0);
  }
});

test('sign: a context carrying batch signs through unchanged', async () => {
  const p = goodParams({ context: 'town=Madison|batch=b1794681290000-a1f3|gps=34.6993,-86.7483' });
  const r = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, params_to_sign: p } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.signature, expectedSignature(p, ENV.CLOUDINARY_API_SECRET));
});

// ---- delete -------------------------------------------------------------

const RESOURCE = 'api.cloudinary.com/v1_1/dxzw1zwez/resources/image/upload/';
const DESTROY = 'api.cloudinary.com/v1_1/dxzw1zwez/image/destroy';
function deleteMock(tags = ['brg-live']) {
  resetNet([
    { match: (u) => u.includes(RESOURCE), reply: () => jsonResponse({ public_id: 'live/job-1', tags }) },
    { match: (u) => u.includes(DESTROY), reply: () => jsonResponse({ result: 'ok' }) }
  ]);
}

test('delete: valid token -> signed destroy -> {ok:true}', async () => {
  deleteMock();
  const r = await call('/api/live/delete', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, id: 'live/job-1' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true });
  assert.ok(callsTo(RESOURCE)[0].url.endsWith('/resources/image/upload/live/job-1'));
  const [d] = callsTo(DESTROY);
  assert.equal(d.init.method, 'POST');
  const form = new URLSearchParams(d.init.body);
  assert.equal(form.get('public_id'), 'live/job-1');
  assert.equal(form.get('api_key'), ENV.CLOUDINARY_API_KEY);
  const signed = { invalidate: form.get('invalidate'), public_id: form.get('public_id'), timestamp: form.get('timestamp') };
  assert.equal(form.get('signature'), expectedSignature(signed, ENV.CLOUDINARY_API_SECRET));
  assert.ok(!d.init.body.includes(ENV.CLOUDINARY_API_SECRET));
});

test('delete: bad token -> 403 after ~1s, Cloudinary never called', async () => {
  deleteMock();
  for (const body of [{ token: 'nope', id: 'live/job-1' }, { id: 'live/job-1' }]) {
    const t0 = Date.now();
    const r = await call('/api/live/delete', { method: 'POST', env: ENV, body });
    assert.equal(r.status, 403);
    assert.ok(Date.now() - t0 >= 900);
  }
  assert.equal(net.calls.length, 0);
});

test('delete: refuses an asset that is not a Live post', async () => {
  deleteMock(['hero']);
  const r = await call('/api/live/delete', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, id: 'heroes/home' } });
  assert.equal(r.status, 404);
  assert.equal(callsTo(DESTROY).length, 0);
});

// ---- missing env --------------------------------------------------------

test('missing env -> loud 500 naming the missing vars, on every endpoint', async () => {
  const cases = [
    ['/api/live/sign', 'POST', { token: ENV.LIVE_POST_TOKEN, params_to_sign: goodParams() }, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN']],
    ['/api/live/feed', 'GET', undefined, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']],
    ['/api/live/delete', 'POST', { token: ENV.LIVE_POST_TOKEN, id: 'live/job-1' }, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN']]
  ];
  for (const [path, method, body, needed] of cases) {
    const all = await call(path, { method, body, env: {} });
    assert.equal(all.status, 500, path);
    for (const v of needed) assert.ok(all.text.includes(v), path + ' does not name ' + v + ': ' + all.text);
    for (const v of needed) {
      const env = { ...ENV };
      delete env[v];
      const one = await call(path, { method, body, env });
      assert.equal(one.status, 500, path + ' without ' + v);
      assert.ok(one.text.includes(v));
      for (const other of needed.filter((x) => x !== v)) assert.ok(!one.text.includes(other), path + ' wrongly names ' + other);
    }
  }
  assert.equal(net.calls.length, 0);
});
