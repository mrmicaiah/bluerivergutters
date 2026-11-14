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
function resource(i, ctx) {
  return {
    asset_id: 'a' + i,
    public_id: 'live/job-' + i,
    version: 1794600000 + i,
    format: 'jpg',
    width: 2000,
    height: 1500,
    created_at: '2026-11-14T15:0' + i + ':00Z',
    uploaded_at: '2026-11-14T15:0' + i + ':05Z',
    tags: ['brg-live'],
    context: ctx
  };
}
function searchMock(resources, next_cursor) {
  resetNet([{
    match: (url) => url.includes(SEARCH),
    reply: () => jsonResponse({ total_count: resources.length, resources, ...(next_cursor ? { next_cursor } : {}) })
  }]);
}
const GPS = '34.6993,-86.7483';

test('feed: shape, URLs, nulls, and Cloudinary search request', async () => {
  searchMock([
    resource(1, { town: 'Madison', taken_at: '2026-11-14T10:02:00Z', comment: 'New 6-inch seamless', gps: GPS }),
    resource(2, { custom: { town: 'Athens', gps: GPS } }) // Admin-API style context
  ], 'cursor-page-2');
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ['next', 'posts']);
  assert.equal(r.json.next, 'cursor-page-2');
  assert.equal(r.json.posts.length, 2);
  const [a, b] = r.json.posts;
  assert.deepEqual(Object.keys(a).sort(), ['comment', 'full', 'h', 'id', 'posted_at', 'taken_at', 'thumb', 'town', 'w']);
  assert.deepEqual(a, {
    id: 'live/job-1', w: 2000, h: 1500,
    thumb: 'https://res.cloudinary.com/dxzw1zwez/image/upload/c_limit,w_500,f_auto,q_auto/v1794600001/live/job-1',
    full: 'https://res.cloudinary.com/dxzw1zwez/image/upload/c_limit,w_2000,f_auto,q_auto/v1794600001/live/job-1',
    town: 'Madison', taken_at: '2026-11-14T10:02:00Z', posted_at: '2026-11-14T15:01:05Z', comment: 'New 6-inch seamless'
  });
  assert.equal(b.town, 'Athens');
  assert.equal(b.taken_at, null);
  assert.equal(b.comment, null);

  const [s] = callsTo(SEARCH);
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.headers.Authorization, 'Basic ' + btoa(ENV.CLOUDINARY_API_KEY + ':' + ENV.CLOUDINARY_API_SECRET));
  const q = JSON.parse(s.init.body);
  assert.match(q.expression, /tags=brg-live/);
  assert.deepEqual(q.sort_by, [{ uploaded_at: 'desc' }]);
  assert.equal(q.max_results, 24);
  assert.equal(q.next_cursor, undefined);
});

test('feed: GPS never leaves the server', async () => {
  searchMock([
    resource(1, { town: 'Madison', gps: GPS, comment: 'c' }),
    resource(2, { custom: { town: 'Decatur', gps: '34.6059,-86.9833' } }),
    { ...resource(3, { town: 'Huntsville', gps: GPS }), metadata: { gps: GPS }, gps: GPS }
  ]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 200);
  assert.ok(!/gps/i.test(r.text), 'feed mentions gps: ' + r.text);
  assert.ok(!r.text.includes('34.6993') && !r.text.includes('-86.7483') && !r.text.includes('34.6059'), 'coordinates leaked: ' + r.text);
});

test('feed: n defaults to 24, caps at 48; cursor passed through; last page -> next null', async () => {
  searchMock([]);
  await call('/api/live/feed?n=500&cursor=abc123', { env: ENV });
  let q = JSON.parse(callsTo(SEARCH)[0].init.body);
  assert.equal(q.max_results, 48);
  assert.equal(q.next_cursor, 'abc123');
  searchMock([]);
  const r = await call('/api/live/feed?n=junk', { env: ENV });
  q = JSON.parse(callsTo(SEARCH)[0].init.body);
  assert.equal(q.max_results, 24);
  assert.deepEqual(r.json, { posts: [], next: null });
  searchMock([]);
  await call('/api/live/feed?n=6', { env: ENV });
  assert.equal(JSON.parse(callsTo(SEARCH)[0].init.body).max_results, 6);
});

test('feed: cached ~60s via caches.default — second hit never reaches Cloudinary', async () => {
  searchMock([resource(1, { town: 'Madison', gps: GPS })]);
  const first = await call('/api/live/feed', { env: ENV });
  assert.equal(callsTo(SEARCH).length, 1);
  assert.equal(cache.puts.length, 1);
  assert.match(cache.puts[0].cacheControl, /max-age=60\b/);
  assert.match(first.headers.get('Cache-Control'), /max-age=60\b/);

  const second = await call('/api/live/feed', { env: ENV });
  assert.equal(callsTo(SEARCH).length, 1, 'second request went to Cloudinary');
  assert.equal(second.text, first.text);
  assert.ok(!/gps/i.test(second.text));

  // Same page asked differently (?n=24 explicitly) shares the key; another page does not.
  await call('/api/live/feed?n=24', { env: ENV });
  assert.equal(callsTo(SEARCH).length, 1);
  await call('/api/live/feed?cursor=p2', { env: ENV });
  assert.equal(callsTo(SEARCH).length, 2);
});

test('feed: Cloudinary failure -> 502, empty feed, not cached', async () => {
  resetNet([{ match: (u) => u.includes(SEARCH), reply: () => new Response('rate limited', { status: 420 }) }]);
  const r = await call('/api/live/feed', { env: ENV });
  assert.equal(r.status, 502);
  assert.deepEqual(r.json.posts, []);
  assert.equal(r.json.next, null);
  assert.equal(cache.store.size, 0);
});

test('feed: junk cursor refused before touching Cloudinary or the cache', async () => {
  const r = await call('/api/live/feed?cursor=' + encodeURIComponent('<script>' + 'x'.repeat(600)), { env: ENV });
  assert.equal(r.status, 400);
  assert.equal(net.calls.length, 0);
  assert.equal(cache.puts.length, 0);
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
