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
    resource_type: 'image',
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
  // Only Live-tagged assets, as the real search's tags=brg-live clause does.
  const sorted = () => assets.filter((a) => a.tags.includes('brg-live')).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at) || b.public_id.localeCompare(a.public_id));
  resetNet([{
    match: (url) => url.includes(SEARCH),
    reply: (url, init) => {
      const q = JSON.parse(init.body);
      assert.match(q.expression, /tags=brg-live/);
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
const ANY_RESOURCE = /api\.cloudinary\.com\/v1_1\/dxzw1zwez\/resources\/(image|video)\/upload\//;
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

// ==== management: POST /api/live/update, POST /api/live/list, hidden posts ====

const TOWNS_OK = ['Madison', 'Huntsville', 'Laceys Spring', 'Owens Cross Roads'];
const UPDATE = '/api/live/update';
const LIST = '/api/live/list';

// Cloudinary context string <-> map, with its backslash escapes for | and =.
function parseContext(s) {
  const out = {};
  for (const pair of s.match(/(?:\\.|[^|])+/g) || []) {
    const m = pair.match(/^((?:\\.|[^=])*)=(.*)$/s);
    const un = (x) => x.replace(/\\(.)/g, '$1');
    if (m) out[un(m[1])] = un(m[2]);
  }
  return out;
}
const flatCtx = (a) => (a.context && a.context.custom) || a.context || {};

// A fake Cloudinary holding `assets` (mutated by updates): Search (honoring a
// context.batch="..." clause), GET resource, and the Admin API update, which
// REPLACES the asset's context with the one given.
function fakeStore(assets, { failUpdate = false } = {}) {
  fakeCloudinary(assets);
  const searchHandler = net.handlers[0];
  // /resources/<type>/upload/<id>: only an asset of that resource type.
  const findAsset = (url) => {
    const m = url.match(/\/resources\/(image|video)\/upload\/(.+)$/);
    const id = decodeURIComponent(m[2]);
    return assets.find((a) => a.public_id === id && (a.resource_type || 'image') === m[1]);
  };
  net.handlers = [
    {
      match: (url) => url.includes(SEARCH),
      reply: (url, init) => {
        const q = JSON.parse(init.body);
        const m = q.expression.match(/context\.batch="([^"]*)"/);
        if (!m) return searchHandler.reply(url, init);
        assert.match(q.expression, /tags=brg-live/, 'batch lookup must be limited to Live assets');
        const hits = assets.filter((a) => a.tags.includes('brg-live') && flatCtx(a).batch === m[1]);
        return jsonResponse({ total_count: hits.length, resources: hits });
      }
    },
    {
      match: (url, init) => ANY_RESOURCE.test(url) && (init.method || 'GET') === 'GET',
      reply: (url) => {
        const a = findAsset(url);
        if (!a) return jsonResponse({ error: { message: 'Resource not found' } }, 404);
        return jsonResponse({ ...a, context: { custom: { ...flatCtx(a) } } });
      }
    },
    {
      match: (url, init) => ANY_RESOURCE.test(url) && init.method === 'POST',
      reply: (url, init) => {
        if (failUpdate) return new Response('boom', { status: 500 });
        const a = findAsset(url);
        if (!a) return jsonResponse({ error: { message: 'Resource not found' } }, 404);
        assert.ok(a.tags.includes('brg-live'), 'updated a non-Live asset: ' + a.public_id);
        const form = new URLSearchParams(init.body);
        a.context = parseContext(form.get('context') || '');
        return jsonResponse({ ...a, context: { custom: a.context } });
      }
    }
  ];
}
const updates = () => net.calls.filter((c) => ANY_RESOURCE.test(c.url) && c.init.method === 'POST');

async function update(fields, env = ENV) {
  return call(UPDATE, { method: 'POST', env, body: { token: ENV.LIVE_POST_TOKEN, ...fields } });
}
async function list(fields = {}, env = ENV) {
  return call(LIST, { method: 'POST', env, body: { token: ENV.LIVE_POST_TOKEN, ...fields } });
}

function sampleStore() {
  const assets = [
    asset('legacy', 5, { town: 'Decatur', comment: 'Old one' }),
    asset('b1', 10, { batch: 'bONE', town: 'Madison', taken_at: '2026-11-14T10:00:00Z', comment: 'First' }),
    asset('b2', 11, { batch: 'bONE' }),
    asset('b3', 12, { batch: 'bONE' }),
    asset('o1', 20, { batch: 'bOTHER', town: 'Athens', comment: 'Leave me' }),
    { ...asset('hero', 30, {}), public_id: 'heroes/home', tags: ['hero'] }
  ];
  fakeStore(assets);
  return assets;
}
const byId = (assets, id) => assets.find((a) => a.public_id === id);

test('routes: /api/live/update and /api/live/list are generated', async () => {
  const { routes } = await loadWorker();
  for (const r of ['/api/live/update', '/api/live/list']) assert.ok(routes.include.includes(r), r);
});

test('update: comment only -> every photo in the batch, nothing else touched', async () => {
  const assets = sampleStore();
  const r = await update({ id: 'bONE', comment: 'Before and after, 6-inch seamless' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(updates().length, 3, 'one update per photo in the batch');
  for (const id of ['live/b1', 'live/b2', 'live/b3']) assert.equal(flatCtx(byId(assets, id)).comment, 'Before and after, 6-inch seamless', id);
  const b1 = flatCtx(byId(assets, 'live/b1'));
  assert.equal(b1.town, 'Madison');
  assert.equal(b1.gps, GPS, 'private gps context preserved');
  assert.equal(b1.batch, 'bONE');
  assert.equal(b1.taken_at, '2026-11-14T10:00:00Z');
  assert.equal(flatCtx(byId(assets, 'live/b2')).town, undefined, 'town not invented where absent');
  assert.equal(flatCtx(byId(assets, 'live/o1')).comment, 'Leave me');
  assert.ok(!r.text.includes(GPS));
});

test('update: town only, and the feed shows it', async () => {
  const assets = sampleStore();
  const r = await update({ id: 'bONE', town: 'Laceys Spring' });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) {
    assert.equal(flatCtx(byId(assets, id)).town, 'Laceys Spring');
    assert.equal(flatCtx(byId(assets, id)).comment, id === 'live/b1' ? 'First' : undefined, 'comment untouched');
  }
  const post = (await feed()).posts.find((p) => p.id === 'bONE');
  assert.equal(post.town, 'Laceys Spring');
});

test('update: hide -> hidden="1" on every photo; feed drops it, list keeps it flagged', async () => {
  const assets = sampleStore();
  const r = await update({ id: 'bONE', hidden: true });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) assert.equal(flatCtx(byId(assets, id)).hidden, '1');
  resetCache();
  const pub = await feed();
  assert.deepEqual(pub.posts.map((p) => p.id), ['bOTHER', 'live/legacy']);
  const l = await list();
  assert.equal(l.status, 200, l.text);
  assert.deepEqual(l.json.posts.map((p) => [p.id, p.hidden]), [['bOTHER', false], ['bONE', true], ['live/legacy', false]]);
});

test('update: unhide removes the key; the post returns to the feed', async () => {
  const assets = sampleStore();
  await update({ id: 'bONE', hidden: true });
  const r = await update({ id: 'bONE', hidden: false });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) {
    assert.ok(!('hidden' in flatCtx(byId(assets, id))), id + ' still carries hidden');
    assert.equal(flatCtx(byId(assets, id)).batch, 'bONE');
  }
  resetCache();
  assert.ok((await feed()).posts.some((p) => p.id === 'bONE'));
});

test('update: combined fields in one call; empty strings clear comment and town', async () => {
  const assets = sampleStore();
  let r = await update({ id: 'bONE', comment: 'New words', town: 'Huntsville', hidden: true });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) {
    assert.deepEqual(
      [flatCtx(byId(assets, id)).comment, flatCtx(byId(assets, id)).town, flatCtx(byId(assets, id)).hidden],
      ['New words', 'Huntsville', '1']
    );
  }
  r = await update({ id: 'bONE', comment: '', town: '' });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) {
    assert.ok(!('comment' in flatCtx(byId(assets, id))));
    assert.ok(!('town' in flatCtx(byId(assets, id))));
    assert.equal(flatCtx(byId(assets, id)).hidden, '1', 'hidden untouched when not given');
  }
});

test('update: a comment with | and = survives Cloudinary context escaping', async () => {
  const assets = sampleStore();
  const comment = 'Pitch = 6/12 | 2 downspouts \\ new';
  const r = await update({ id: 'live/legacy', comment });
  assert.equal(r.status, 200, r.text);
  assert.equal(flatCtx(byId(assets, 'live/legacy')).comment, comment);
  assert.equal(flatCtx(byId(assets, 'live/legacy')).town, 'Decatur');
});

test('update: legacy single-photo post (id = public_id) is manageable, incl. hide', async () => {
  const assets = sampleStore();
  let r = await update({ id: 'live/legacy', comment: 'Edited', town: 'Madison' });
  assert.equal(r.status, 200, r.text);
  assert.equal(updates().length, 1);
  assert.equal(flatCtx(byId(assets, 'live/legacy')).comment, 'Edited');
  r = await update({ id: 'live/legacy', hidden: true });
  assert.equal(r.status, 200, r.text);
  resetCache();
  assert.ok(!(await feed()).posts.some((p) => p.id === 'live/legacy'));
  assert.equal((await list()).json.posts.find((p) => p.id === 'live/legacy').hidden, true);
});

test('update: a photo id inside a batch manages its whole batch', async () => {
  const assets = sampleStore();
  const r = await update({ id: 'live/b2', hidden: true });
  assert.equal(r.status, 200, r.text);
  for (const id of ['live/b1', 'live/b2', 'live/b3']) assert.equal(flatCtx(byId(assets, id)).hidden, '1', id);
});

test('update: town outside the service area -> 400 naming why; nothing written', async () => {
  sampleStore();
  for (const town of ['Nashville', 'madison', ' Madison', 'Huntsville AL', 5]) {
    const r = await update({ id: 'bONE', town });
    assert.equal(r.status, 400, JSON.stringify(town) + ' -> ' + r.status);
    assert.match(r.json.error, /town/i);
  }
  for (const town of TOWNS_OK) assert.equal((await update({ id: 'bONE', town })).status, 200, town);
  net.calls = [];
  await update({ id: 'bONE', town: 'Nashville' });
  assert.equal(updates().length, 0);
});

test('update: other bad fields -> 400 with a readable reason, before any write', async () => {
  sampleStore();
  const cases = {
    'comment too long': { id: 'bONE', comment: 'x'.repeat(301) },
    'comment not a string': { id: 'bONE', comment: 42 },
    'hidden not boolean': { id: 'bONE', hidden: '1' },
    'nothing to change': { id: 'bONE' },
    'unknown field': { id: 'bONE', gps: '1,2' },
    'no id': { comment: 'x' },
    'id not a string': { id: 7, comment: 'x' }
  };
  for (const [name, body] of Object.entries(cases)) {
    net.calls = [];
    const r = await update(body);
    assert.equal(r.status, 400, name + ' -> ' + r.status + ' ' + r.text);
    assert.ok(typeof r.json.error === 'string' && r.json.error.length > 3, name);
    assert.equal(updates().length, 0, name + ' wrote');
  }
  assert.equal((await update({ id: 'bONE', comment: 'y'.repeat(300) })).status, 200, '300 chars is fine');
});

test('update: bad token -> the same 403 as sign after ~1s; Cloudinary never called', async () => {
  sampleStore();
  const signBad = await call('/api/live/sign', { method: 'POST', env: ENV, body: { token: 'nope' } });
  for (const body of [{ token: 'nope', id: 'bONE', hidden: true }, { id: 'bONE', hidden: true }]) {
    const t0 = Date.now();
    const r = await call(UPDATE, { method: 'POST', env: ENV, body });
    assert.equal(r.status, 403);
    assert.ok(Date.now() - t0 >= 900);
    assert.equal(r.text, signBad.text);
  }
  const raw = await call(UPDATE, { method: 'POST', env: ENV, rawBody: 'not json' });
  assert.equal(raw.status, 403);
  assert.equal(net.calls.length, 0);
});

test('update: unknown id or a non-Live asset -> 404, never written', async () => {
  sampleStore();
  for (const id of ['bNOPE', 'live/missing', 'heroes/home']) {
    net.calls = [];
    const r = await update({ id, hidden: true });
    assert.equal(r.status, 404, id + ' -> ' + r.status + ' ' + r.text);
    assert.deepEqual(r.json, { error: 'not found' }, id + ' (the function, not a missing route)');
    assert.equal(updates().length, 0, id);
  }
});

test('update: Cloudinary failure -> 502', async () => {
  fakeStore([asset('b1', 10, { batch: 'bONE', town: 'Madison' })], { failUpdate: true });
  const r = await update({ id: 'bONE', comment: 'x' });
  assert.equal(r.status, 502, r.text);
  assert.equal(r.json.ok, undefined);
});

// ---- hidden posts and the public feed's paging --------------------------

test('feed: a batch with ANY photo hidden="1" is excluded', async () => {
  fakeStore([
    asset('v1', 1, { town: 'T' }),
    asset('h1', 2, { batch: 'bH', town: 'T' }), asset('h2', 3, { batch: 'bH', hidden: '1' }), asset('h3', 4, { batch: 'bH' }),
    asset('v2', 5, { town: 'T', hidden: '0' })
  ]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.deepEqual(r.json.posts.map((p) => p.id), ['live/v2', 'live/v1']);
  assert.ok(!/hidden/.test(r.text), 'public feed never mentions hidden');
});

test('feed: hidden posts never surface through any cursor edge (pages x windows)', async () => {
  // Visible singles and batches with hidden batches straddling search windows
  // (100) and every page boundary for a range of n; some hidden batches only
  // carry the flag on ONE photo (a partial write), at either end.
  const assets = [];
  let t = 0;
  const hiddenIds = new Set();
  const add = (name, ctx, hide) => { const a = asset(name, t++, ctx); assets.push(a); if (hide) hiddenIds.add(a.public_id); };
  for (let g = 0; g < 40; g++) {
    add('s' + g, { town: 'T' });
    for (let i = 0; i < 4; i++) add('vb' + g + '-' + i, { batch: 'bV' + g, town: 'T' });
    const flag = g % 3; // 0: all flagged, 1: only first-uploaded, 2: only last-uploaded
    for (let i = 0; i < 3; i++) {
      const ctx = { batch: 'bH' + g, town: 'T' };
      if (flag === 0 || (flag === 1 && i === 0) || (flag === 2 && i === 2)) ctx.hidden = '1';
      add('hb' + g + '-' + i, ctx, true);
    }
  }
  fakeStore(assets);
  for (const n of [1, 2, 3, 7, 24, 48]) {
    const pages = await allPages(n);
    const seen = pages.flatMap((p) => p.posts).flatMap(ids);
    for (const id of seen) assert.ok(!hiddenIds.has(id), 'n=' + n + ': hidden photo ' + id + ' surfaced');
    assert.equal(seen.length, assets.length - hiddenIds.size, 'n=' + n + ': visible photos lost or duplicated');
    assert.equal(new Set(seen).size, seen.length);
    for (const p of pages) assert.ok(p.posts.length <= n);
  }
});

test('feed: a huge hidden batch flagged on one photo, read past the call limit, stays hidden on the next page', async () => {
  const assets = [asset('older', 1, { town: 'T' })];
  for (let i = 0; i < 700; i++) assets.push(asset('big' + String(i).padStart(3, '0'), 100 + i, i === 699 ? { batch: 'bHUGE', hidden: '1' } : { batch: 'bHUGE' }));
  fakeStore(assets);
  const pages = await allPages(5);
  const seen = pages.flatMap((p) => p.posts).map((p) => p.id);
  assert.deepEqual(seen, ['live/older']);
});

// ---- list ---------------------------------------------------------------

test('list: feed post shape + hidden, newest first, includes hidden, private no-store, never cached', async () => {
  sampleStore();
  await update({ id: 'bOTHER', hidden: true });
  net.calls = [];
  const r = await list();
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('Cache-Control'), /no-store/);
  assert.match(r.headers.get('Cache-Control'), /private/);
  assert.equal(cache.puts.length, 0, 'list response went into the cache');
  assert.deepEqual(Object.keys(r.json).sort(), ['next', 'posts']);
  assert.deepEqual(r.json.posts.map((p) => [p.id, p.hidden]), [['bOTHER', true], ['bONE', false], ['live/legacy', false]]);
  const one = r.json.posts[1];
  assert.deepEqual(Object.keys(one).sort(), ['comment', 'count', 'hidden', 'id', 'photos', 'posted_at', 'taken_at', 'town']);
  assert.equal(one.count, 3);
  assert.equal(one.comment, 'First');
  assert.ok(!/gps/i.test(r.text) && !r.text.includes('34.6993'), 'gps leaked from list');
  // A second identical call goes to Cloudinary again: no caching.
  const before = callsTo(SEARCH).length;
  await list();
  assert.ok(callsTo(SEARCH).length > before);
});

test('list: pages with the same cursor machinery, hidden posts included exactly once', async () => {
  const assets = [];
  for (let g = 0; g < 30; g++) {
    assets.push(asset('s' + g, g * 10, { town: 'T', ...(g % 4 === 0 ? { hidden: '1' } : {}) }));
    for (let i = 0; i < 5; i++) assets.push(asset('b' + g + '-' + i, g * 10 + 1 + i, { batch: 'bL' + g, town: 'T', ...(g % 2 ? { hidden: '1' } : {}) }));
  }
  fakeStore(assets);
  for (const n of [1, 4, 48]) {
    const seen = [];
    let cursor;
    for (let guard = 0; guard < 200; guard++) {
      const r = await list({ n, ...(cursor ? { cursor } : {}) });
      assert.equal(r.status, 200, r.text);
      assert.ok(r.json.posts.length <= n);
      for (const p of r.json.posts) {
        seen.push(...ids(p));
        assert.equal(p.hidden, p.id.startsWith('bL') ? Number(p.id.slice(2)) % 2 === 1 : Number(p.id.slice(6)) % 4 === 0, p.id);
      }
      if (!r.json.next) break;
      cursor = r.json.next;
    }
    assert.equal(seen.length, assets.length, 'n=' + n);
    assert.equal(new Set(seen).size, assets.length);
  }
  assert.equal(cache.puts.length, 0);
});

test('list: bad token -> 403 after ~1s, no Cloudinary; bad cursor -> 400', async () => {
  sampleStore();
  const t0 = Date.now();
  const r = await call(LIST, { method: 'POST', env: ENV, body: { token: 'wrong' } });
  assert.equal(r.status, 403);
  assert.ok(Date.now() - t0 >= 900);
  assert.equal(net.calls.length, 0);
  const bad = await list({ cursor: 'not-a-real-cursor' });
  assert.equal(bad.status, 400);
  assert.equal(net.calls.length, 0);
});

test('update + list: missing env -> loud 500 naming the missing vars', async () => {
  const needed = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN'];
  for (const [path, body] of [[UPDATE, { token: ENV.LIVE_POST_TOKEN, id: 'bONE', hidden: true }], [LIST, { token: ENV.LIVE_POST_TOKEN }]]) {
    const all = await call(path, { method: 'POST', body, env: {} });
    assert.equal(all.status, 500, path);
    for (const v of needed) assert.ok(all.text.includes(v), path + ' does not name ' + v);
    for (const v of needed) {
      const env = { ...ENV };
      delete env[v];
      const one = await call(path, { method: 'POST', body, env });
      assert.equal(one.status, 500, path + ' without ' + v);
      assert.ok(one.text.includes(v));
    }
  }
  assert.equal(net.calls.length, 0);
});

// ==== video (WO-0150) ======================================================

const VIDEO_T = 'c_limit,w_1280,h_1280,q_auto,vc_auto';
const VBASE = 'https://res.cloudinary.com/dxzw1zwez/video/upload/';

// One Cloudinary video asset; `duration` in seconds (undefined = not reported).
function video(name, t, duration, ctx = {}) {
  const a = { ...asset(name, t, ctx), resource_type: 'video', format: 'mov', width: 720, height: 1280 };
  if (duration !== undefined) a.duration = duration;
  return a;
}

async function signAs(resource_type, params) {
  const body = { token: ENV.LIVE_POST_TOKEN, params_to_sign: params };
  if (resource_type !== undefined) body.resource_type = resource_type;
  return call('/api/live/sign', { method: 'POST', env: ENV, body });
}

test('sign video: the video cap set (any order) is signed, same folder/tag/context rules', async () => {
  for (const t of [VIDEO_T, 'vc_auto,q_auto,h_1280,c_limit,w_1280']) {
    const p = goodParams({ transformation: t, context: 'town=Madison|batch=b1794681290000-a1f3|taken_at=2026-11-14T10:02:00Z|comment=Clip|gps=34.6993,-86.7483' });
    const r = await signAs('video', p);
    assert.equal(r.status, 200, t + ' ' + r.text);
    assert.equal(r.json.signature, expectedSignature(p, ENV.CLOUDINARY_API_SECRET), 'resource_type is never part of the signature');
    assert.equal(r.json.cloud_name, 'dxzw1zwez');
  }
  for (const [name, p] of Object.entries({
    'wrong folder': goodParams({ transformation: VIDEO_T, folder: 'projects/' }),
    'no brg-live tag': goodParams({ transformation: VIDEO_T, tags: 'crew' }),
    'unknown param': goodParams({ transformation: VIDEO_T, eager: 'sp_auto' })
  })) {
    const r = await signAs('video', p);
    assert.equal(r.status, 400, name);
  }
});

test('sign video: anything but exactly the video cap set is refused', async () => {
  const cases = {
    'image cap on a video': TRANSFORMATION,
    'no vc_auto': 'c_limit,w_1280,h_1280,q_auto',
    'no q_auto': 'c_limit,w_1280,h_1280,vc_auto',
    'bigger': 'c_limit,w_1920,h_1920,q_auto,vc_auto',
    'trimmed (du_)': VIDEO_T + ',du_30',
    'chained step': VIDEO_T + '/e_sepia',
    'q_auto:good instead': 'c_limit,w_1280,h_1280,q_auto:good,vc_auto',
    'empty': ''
  };
  for (const [name, t] of Object.entries(cases)) {
    const r = await signAs('video', goodParams({ transformation: t }));
    assert.equal(r.status, 400, name + ' -> ' + r.status);
    assert.match(r.json.error, /transformation/, name);
    assert.ok(!r.json.signature);
  }
});

test('sign: image rules unchanged — video cap refused for images; resource_type image/absent same; junk type 400', async () => {
  assert.equal((await signAs('image', goodParams())).status, 200);
  assert.equal((await signAs(undefined, goodParams())).status, 200);
  const r = await signAs(undefined, goodParams({ transformation: VIDEO_T }));
  assert.equal(r.status, 400);
  for (const t of ['raw', 'auto', 'VIDEO', 5]) {
    const bad = await signAs(t, goodParams());
    assert.equal(bad.status, 400, JSON.stringify(t));
    assert.match(bad.json.error, /resource_type/);
  }
});

test('feed: video entry shape and URLs; images keep their exact shape (no kind key)', async () => {
  fakeStore([
    asset('pic', 10, { batch: 'bMIX', town: 'Madison' }),
    video('clip', 11, 12.4, { batch: 'bMIX' })
  ]);
  const { posts } = await feed();
  assert.equal(posts.length, 1);
  const [pic, clip] = posts[0].photos;
  assert.equal(posts[0].count, 2);
  assert.deepEqual(Object.keys(pic).sort(), ['full', 'h', 'id', 'thumb', 'w']);
  assert.deepEqual(clip, {
    id: 'live/clip', w: 720, h: 1280,
    kind: 'video',
    duration: 12.4,
    thumb: VBASE + 'so_0,c_limit,w_500,f_jpg,q_auto/v1794600011/live/clip.jpg',
    full: VBASE + 'so_0,c_limit,w_1000,f_jpg,q_auto/v1794600011/live/clip.jpg',
    poster: VBASE + 'so_0,c_limit,w_1000,f_jpg,q_auto/v1794600011/live/clip.jpg',
    mp4: VBASE + 'f_mp4,vc_auto,q_auto/v1794600011/live/clip.mp4'
  });
  const q = JSON.parse(callsTo(SEARCH)[0].init.body);
  assert.match(q.expression, /resource_type:image/);
  assert.match(q.expression, /resource_type:video/);
  assert.match(q.expression, /tags=brg-live/);
});

test('feed: duration backstop — >31s video dropped, its post stays; video-only post drops; unknown duration fails closed', async () => {
  fakeStore([
    asset('p1', 10, { batch: 'bA', town: 'T' }), video('long', 11, 45, { batch: 'bA' }), video('ok', 12, 31, { batch: 'bA' }),
    video('alone-long', 20, 31.5, { batch: 'bB', town: 'T' }),
    video('alone-ok', 30, 30.0, { town: 'T' }),
    video('unknown', 40, undefined, { town: 'T' })
  ]);
  const { posts } = await feed();
  assert.deepEqual(posts.map((p) => [p.id, ids(p)]), [
    ['live/alone-ok', ['live/alone-ok']],
    ['bA', ['live/p1', 'live/ok']]
  ]);
  assert.equal(posts[1].count, 2);
});

test('feed: overlong-only posts never cost a page slot or break paging', async () => {
  const assets = [];
  for (let i = 0; i < 60; i++) {
    assets.push(asset('s' + i, i * 3, { town: 'T' }));
    assets.push(video('v' + i, i * 3 + 1, i % 2 ? 90 : 8, { batch: 'bV' + i, town: 'T' }));
  }
  fakeStore(assets);
  for (const n of [1, 5, 24]) {
    const pages = await allPages(n);
    const seen = pages.flatMap((p) => p.posts).flatMap(ids);
    assert.equal(seen.length, 90, 'n=' + n);
    assert.ok(seen.every((id) => !/^live\/v\d*[13579]$/.test(id)), 'overlong surfaced');
    for (const p of pages.slice(0, -1)) assert.equal(p.posts.length, n, 'n=' + n + ': short page');
  }
});

test('list: overlong video included, flagged overlong:true; short videos overlong:false; images unflagged', async () => {
  fakeStore([
    asset('p1', 10, { batch: 'bA', town: 'T' }), video('long', 11, 45, { batch: 'bA' }), video('ok', 12, 20, { batch: 'bA' }),
    video('alone-long', 20, 300, { batch: 'bB', town: 'T' })
  ]);
  const r = await list();
  assert.equal(r.status, 200, r.text);
  const [b, a] = r.json.posts;
  assert.equal(b.id, 'bB');
  assert.deepEqual(b.photos.map((p) => p.overlong), [true]);
  assert.deepEqual(a.photos.map((p) => [p.id, p.kind, p.overlong]), [
    ['live/p1', undefined, undefined], ['live/long', 'video', true], ['live/ok', 'video', false]
  ]);
});

test('update: a batch holding videos updates every asset, each via its own resource type', async () => {
  const assets = [asset('p1', 10, { batch: 'bV', town: 'Madison' }), video('c1', 11, 10, { batch: 'bV' })];
  fakeStore(assets);
  const r = await update({ id: 'bV', hidden: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.photos, 2);
  assert.deepEqual(updates().map((c) => c.url.match(/resources\/(\w+)\/upload\/(.+)$/).slice(1)), [['image', 'live/p1'], ['video', 'live/c1']]);
  assert.equal(flatCtx(assets[1]).hidden, '1');
  assert.equal(flatCtx(assets[1]).gps, GPS);
});

test('update: a legacy single video found by its public_id', async () => {
  const assets = [video('solo', 10, 10, { town: 'Madison' })];
  fakeStore(assets);
  const r = await update({ id: 'live/solo', comment: 'Clip' });
  assert.equal(r.status, 200, r.text);
  assert.equal(flatCtx(assets[0]).comment, 'Clip');
});

test('delete: a Live video is destroyed as a video; nothing else changes', async () => {
  const VDESTROY = 'api.cloudinary.com/v1_1/dxzw1zwez/video/destroy';
  resetNet([
    { match: (u) => u.includes('/resources/image/upload/'), reply: () => jsonResponse({ error: { message: 'Resource not found' } }, 404) },
    { match: (u) => u.includes('/resources/video/upload/'), reply: () => jsonResponse({ public_id: 'live/clip', resource_type: 'video', tags: ['brg-live'] }) },
    { match: (u) => u.includes(VDESTROY), reply: () => jsonResponse({ result: 'ok' }) }
  ]);
  const r = await call('/api/live/delete', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, id: 'live/clip' } });
  assert.equal(r.status, 200, r.text);
  const [d] = callsTo(VDESTROY);
  const form = new URLSearchParams(d.init.body);
  assert.equal(form.get('public_id'), 'live/clip');
  const signed = { invalidate: form.get('invalidate'), public_id: form.get('public_id'), timestamp: form.get('timestamp') };
  assert.equal(form.get('signature'), expectedSignature(signed, ENV.CLOUDINARY_API_SECRET));
  assert.equal(callsTo('/image/destroy').length, 0);
});

test('delete: a non-Live video is refused; an id that is neither image nor video is 404', async () => {
  resetNet([
    { match: (u) => u.includes('/resources/image/upload/'), reply: () => jsonResponse({ error: {} }, 404) },
    { match: (u) => u.includes('/resources/video/upload/promo'), reply: () => jsonResponse({ public_id: 'promo', resource_type: 'video', tags: ['marketing'] }) },
    { match: (u) => u.includes('/resources/video/upload/'), reply: () => jsonResponse({ error: {} }, 404) }
  ]);
  for (const id of ['promo', 'live/gone']) {
    const r = await call('/api/live/delete', { method: 'POST', env: ENV, body: { token: ENV.LIVE_POST_TOKEN, id } });
    assert.equal(r.status, 404, id);
  }
  assert.equal(net.calls.filter((c) => c.url.includes('destroy')).length, 0);
});
