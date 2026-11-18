// The server renderer for Blue River Live (functions/_shared/render.js) and
// the shared core it is built on (src/_data/liveCore.js) — WO-0150 #269.
// The SSR pipeline around it (shell, markers, paging, caching) is covered in
// live.test.mjs; the page's hydration of this HTML in the browser harness.
// RENDER=<path> runs these against another render.js (red-first checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

const { renderStream, renderHead } = await import(pathToFileURL(process.env.RENDER || join(ROOT, 'functions/_shared/render.js')).href);
const liveCore = createRequire(import.meta.url)(join(ROOT, 'src/_data/liveCore.js'));

const NOW = Date.parse('2026-11-17T20:41:00Z'); // 2:41 PM in Chicago (CST)
const IMG = 'https://res.cloudinary.com/dxzw1zwez/image/upload/';
const VID = 'https://res.cloudinary.com/dxzw1zwez/video/upload/';
const photo = (id, w = 1600, h = 1200) => ({ id, w, h, thumb: IMG + 'c_limit,w_500,f_auto,q_auto/v1/live/' + id, full: IMG + 'c_limit,w_2000,f_auto,q_auto/v1/live/' + id });
const video = (id, duration = 23.2) => ({ id, w: 1080, h: 1920, kind: 'video', duration,
  thumb: VID + 'so_0,c_limit,w_500,f_jpg,q_auto/v1/live/' + id + '.jpg', full: VID + 'so_0,c_limit,w_1000,f_jpg,q_auto/v1/live/' + id + '.jpg',
  poster: VID + 'so_0,c_limit,w_1000,f_jpg,q_auto/v1/live/' + id + '.jpg', mp4: VID + 'f_mp4,vc_auto,q_auto/v1/live/' + id + '.mp4' });
const post = (i, o = {}) => ({ id: 'p' + i, photos: [photo('j' + i)], count: 1, town: 'Decatur', taken_at: null,
  posted_at: new Date(NOW - i * 3600000).toISOString(), comment: null, ...o });
const render = (posts, o = {}) => renderStream(posts, { pageNum: 1, nextUrl: null, prevUrl: null, now: NOW, ...o });
const tags = (html, re) => html.match(re) || [];
const posts = (html) => tags(html, /<li class="ls-post[^"]*"[^>]*>/g);
const imgs = (html) => tags(html, /<img\b[^>]*>/g);
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('render: v3 card markup — rail node, card, strip, LIVE chip, factual stamp, ticking time, comment', () => {
  const h = render([post(0, { comment: 'New 6-inch seamless run', taken_at: new Date(NOW - 86400000).toISOString() })]);
  assert.equal(posts(h).length, 1);
  const li = posts(h)[0];
  assert.match(li, /class="ls-post is-left is-live"/);
  assert.equal(attr(li, 'id'), 'ls-1');
  assert.equal(attr(li, 'data-id'), 'p0');
  for (const s of ['<span class="ls-node" aria-hidden="true"></span>', '<article class="ls-card">', '<div class="live-media">', '<div class="live-strip" style="aspect-ratio: 1.3333333333333333">',
    '<span class="live-chip"><span class="live-dot is-live"></span>LIVE</span>', '<div class="ls-body">', '<p class="ls-comment">New 6-inch seamless run</p>']) assert.ok(h.includes(s), s);
  assert.match(h, /<h3 class="ls-head" data-t="[^"]+" data-town="Decatur">Decatur · Nov 17, 2:41 PM<\/h3>/, 'factual stamp, no poetry');
  assert.match(h, /<p class="ls-sub">Posted <time datetime="[^"]+" data-posted="[^"]+">just now<\/time> · taken Nov 16<\/p>/);
  assert.ok(h.startsWith('<li class="ls-day is-today"'), 'a day node opens the run');
  assert.match(h, /<span class="ls-day-label">Today<\/span>/);
});

test('render: the stamp is Chicago wall time, no town -> time only; older than a day has no LIVE chip', () => {
  const h = render([post(30, { town: '' })]);
  assert.match(h, />Nov 16, 8:41 AM<\/h3>/);
  assert.ok(!h.includes('live-chip'));
  assert.match(posts(h)[0], /class="ls-post is-left"/);
  // DST: a July post is CDT (UTC-5)
  assert.match(render([post(0, { posted_at: '2026-07-04T17:05:00Z' })]), /Decatur · Jul 4, 12:05 PM/);
});

test('render: ALT text — "{Service} in {Town}, AL" from the hooks\' keyword map, caption appended, fallback, batch position', () => {
  const cases = [
    [{ comment: 'Cleaned out clogged gutters' }, 'Gutter cleaning in Decatur, AL — Cleaned out clogged gutters'],
    [{ comment: 'Leaf guards installed', town: 'Madison' }, 'Gutter guards in Madison, AL — Leaf guards installed'],
    [{ comment: 'New 6-inch seamless run' }, 'Seamless gutters in Decatur, AL — New 6-inch seamless run'],
    [{ comment: 'Rerouted the downspout off the foundation' }, 'Downspouts in Decatur, AL — Rerouted the downspout off the foundation'],
    [{ comment: 'Underground drain to the street' }, 'Drainage work in Decatur, AL — Underground drain to the street'],
    [{ comment: 'Replaced rotten fascia' }, 'Wood rot repair in Decatur, AL — Replaced rotten fascia'],
    [{}, 'Gutter work in Decatur, AL'],
    [{ town: '' }, 'Gutter work'],
    [{ town: '', comment: 'Nice day' }, 'Gutter work — Nice day'],
    [{ comment: 'Tom & Jerry\'s "house" <b>' }, 'Gutter work in Decatur, AL — Tom & Jerry\'s "house" <b>']
  ];
  for (const [o, want] of cases) {
    const a = attr(imgs(render([post(0, o)]))[0], 'alt');
    assert.equal(unesc(a), want, JSON.stringify(o));
  }
  const b = render([post(0, { photos: [photo('a'), photo('b'), video('c')], count: 3, comment: 'Seamless run' })]);
  assert.deepEqual(imgs(b).map((t) => unesc(attr(t, 'alt'))), [
    'Seamless gutters in Decatur, AL — Seamless run (photo 1 of 3)',
    'Seamless gutters in Decatur, AL — Seamless run (photo 2 of 3)',
    'Seamless gutters in Decatur, AL — Seamless run (video 3 of 3)']);
  // the client shares the same rule: same core
  const C = liveCore.core(liveCore.basics());
  assert.equal(C.alt({ town: 'Athens', comment: 'Flushed the downspouts' }, {}, 0, 1), 'Gutter cleaning in Athens, AL — Flushed the downspouts');
});

test('render: a video — poster img in the reserved box, a real link to the mp4 as the play control, duration chip; aria-label carries duration + alt', () => {
  const h = render([post(0, { photos: [video('clip')], comment: 'Seamless run', town: 'Madison' })]);
  assert.match(h, /<div class="live-slide is-video" style="aspect-ratio: 1080 \/ 1920" data-mp4="[^"]+clip\.mp4" data-poster="[^"]+w_1000[^"]+clip\.jpg" data-duration="23">/);
  const img = imgs(h)[0];
  assert.equal(attr(img, 'width'), '1080');
  assert.equal(attr(img, 'height'), '1920');
  assert.match(attr(img, 'src'), /video\/upload\/so_0,c_limit,w_500,f_jpg,q_auto\/v1\/live\/clip\.jpg$/);
  assert.equal(unesc(attr(img, 'alt')), 'Seamless gutters in Madison, AL — Seamless run');
  const play = h.match(/<a class="live-play"[^>]*>/)[0];
  assert.match(attr(play, 'href'), /f_mp4,vc_auto,q_auto\/v1\/live\/clip\.mp4$/);
  assert.equal(unesc(attr(play, 'aria-label')), 'Play video, 0:23 — Seamless gutters in Madison, AL — Seamless run');
  assert.match(h, /<span class="live-dur">0:23<\/span>/);
  assert.ok(!/<video/.test(h), 'no <video> element (no bytes before a tap)');
  // a video without a safe mp4 is just its poster
  const bad = render([post(0, { photos: [{ ...video('x'), mp4: 'javascript:alert(1)' }] })]);
  assert.ok(!bad.includes('live-play') && !bad.includes('javascript:'));
});

test('render: loading — the first 4 stream images load at once (no loading attr; the first is fetchpriority high), the rest lazy', () => {
  const h = render([post(0, { photos: [photo('a'), photo('b'), photo('c')], count: 3 }), post(1), post(2), post(3)]);
  const all = imgs(h);
  assert.equal(all.length, 6);
  assert.equal(attr(all[0], 'fetchpriority'), 'high');
  all.slice(0, 4).forEach((t, i) => assert.equal(attr(t, 'loading'), null, 'img ' + i + ' eager'));
  all.slice(1).forEach((t) => assert.equal(attr(t, 'fetchpriority'), null));
  all.slice(4).forEach((t, i) => { assert.equal(attr(t, 'loading'), 'lazy', 'img ' + (i + 4)); assert.equal(attr(t, 'decoding'), 'async'); });
  for (const t of all) assert.match(attr(t, 'srcset'), / 500w, .*c_limit,w_1000,.* 1000w$/);
});

test('render: stream order — day nodes per day, form spot after post 2, hooks after every 4th, form2 spot on a long page, zigzag sides, ids', () => {
  const list = Array.from({ length: 12 }, (_, i) => post(i, { posted_at: new Date(NOW - i * 5 * 3600000).toISOString(), comment: i === 3 ? 'Cleaned the gutters' : null }));
  const h = render(list);
  const seq = tags(h, /<li class="(ls-[a-z]+)[^"]*"(?: data-spot="(\w+)")?/g).map((t) => {
    const m = t.match(/<li class="(ls-[a-z]+)[^"]*"(?: data-spot="(\w+)")?/);
    return m[2] ? m[2] : { 'ls-day': 'D', 'ls-post': 'P', 'ls-hook': 'H' }[m[1]];
  }).join('');
  // every 5h back from 2:41 PM: posts 1-3 on the 17th, 4-8 the 16th, 9-12 the 15th;
  // a day node re-opens after the form; hooks after posts 4 and 8
  assert.equal(seq, 'DPPformDPDPHPPPPHDPPPPform2', seq);
  assert.deepEqual(posts(h).map((t) => attr(t, 'id')), list.map((_, i) => 'ls-' + (i + 1)));
  assert.deepEqual(posts(h).map((t) => /is-left/.test(t) ? 'L' : 'R').join(''), 'LRLRLRLRLRLR');
  assert.match(h, /<li class="ls-hook" data-kind="clean">/, 'hook keyed to post 4 (its comment)');
});

test('render: end point — "Older work →" as a real link on the rail; archive pages link back up; the last archive page ends at the beginning', () => {
  const list = [post(0), post(1), post(2)];
  const one = render(list, { nextUrl: '/live/page/2/' });
  assert.match(one, /<li class="ls-older"><span class="ls-node" aria-hidden="true"><\/span><a class="ls-older-link" href="\/live\/page\/2\/"><span class="ls-older-kicker">That’s everything from this stretch — older work continues<\/span><span class="ls-older-cta">Older work →<\/span><\/a><\/li>$/);
  assert.ok(!one.includes('ls-newer'), 'page 1 has no newer link');
  const two = render(list, { pageNum: 2, prevUrl: '/live/', nextUrl: '/live/page/3/' });
  assert.ok(two.startsWith('<li class="ls-newer"><span class="ls-node" aria-hidden="true"></span><a class="ls-newer-link" href="/live/">← Newer work from the field</a></li>'), two.slice(0, 160));
  assert.match(two, /href="\/live\/page\/3\/"/);
  const last = render(list, { pageNum: 3, prevUrl: '/live/page/2/' });
  assert.match(last, /<li class="ls-older is-start">.*You’ve reached the beginning.*<\/li>$/);
  assert.ok(!/<a class="ls-older-link"/.test(last), 'nothing further to link');
  assert.ok(!/ls-older/.test(render(list)), 'page 1 without a next page has no end link');
});

test('render: feed text is escaped, URLs are checked, no <script>, no nested list (the slot ends at the shell\'s </ol>)', () => {
  const evil = post(0, { town: '<img src=x onerror=alert(1)>', comment: '</ol><script>alert(1)</script>', id: 'p"><script>',
    photos: [{ ...photo('a'), thumb: 'javascript:alert(1)' }, photo('b')] });
  const h = render([evil, post(1)], { nextUrl: '/live/page/2/' });
  assert.ok(!/<script/i.test(h));
  assert.ok(!/<\/?ol\b/i.test(h));
  assert.ok(!/javascript:/i.test(h));
  assert.ok(!/<img src=x/.test(h));
  assert.equal(imgs(h).length, 2, 'the photo with a bad URL is dropped, the post stays');
  // posts that can't render are skipped, not thrown on
  assert.equal(posts(render([{ id: 'z', photos: [], posted_at: 'nope' }, null, post(2)])).length, 1);
  assert.equal(render([]), '');
});

test('render: head — one canonical, absolute prev/next', () => {
  assert.equal(renderHead(2, { prevUrl: '/live/', nextUrl: '/live/page/3/', canonical: 'https://bluerivergutters.com/live/page/2/' }),
    '<link rel="canonical" href="https://bluerivergutters.com/live/page/2/"><link rel="prev" href="https://bluerivergutters.com/live/"><link rel="next" href="https://bluerivergutters.com/live/page/3/">');
  assert.equal(renderHead(1, { canonical: 'https://bluerivergutters.com/live/' }), '<link rel="canonical" href="https://bluerivergutters.com/live/">');
});
