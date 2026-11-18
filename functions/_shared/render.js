// Server-rendered Blue River Live: the stream's HTML and the head tags for
// /live/ and /live/page/<n>/ (called by functions/_shared/ssr.js, which
// fetches the static /live/ shell and injects these at its markers).
// Exports no onRequest handler, so Pages never turns this file into a route.
//
// renderStream(posts, { pageNum, nextUrl, prevUrl }) -> HTML string
//   posts    one page of the public feed's posts (functions/_shared/feed.js
//            shape; video entries carry kind/mp4/poster), hidden posts and
//            overlong videos already removed
//   nextUrl  site path of the next (older) archive page, or null at the end
//            ("Older work →" links here); prevUrl the newer page or null
//   The HTML goes inside the shell's data-ssr-slot list (#live-stream), at
//   <!--brg-ssr:stream-->. No <script>.
//
// renderHead(pageNum, { prevUrl, nextUrl, canonical }) -> HTML string
//   Exactly one <link rel="canonical"> (the shell's own is removed before
//   injection) plus rel="prev"/rel="next" when given; in <head>.
//
// The markup and words come from src/_data/liveCore.js — the same factories
// the page itself inlines, so a server-rendered card and one the browser
// builds are the same HTML, and the browser only hydrates what's here.
// Stamps are factual ("Decatur · Nov 17, 2:41 PM"); the page upgrades them
// to its present-tense lines. Times and LIVE chips are as of render time
// (cached 60s); the page re-ticks them.
import liveCore from '../../src/_data/liveCore.js';

const SITE = 'https://bluerivergutters.com';
const B = liveCore.basics();
const C = liveCore.core(B);

export function renderStream(posts, { pageNum = 1, nextUrl = null, prevUrl = null, now = Date.now() } = {}) {
  return C.stream(Array.isArray(posts) ? posts : [], { pageNum, nextUrl, prevUrl, now });
}

const abs = (p) => (/^\//.test(p) ? SITE + p : p);

export function renderHead(pageNum, { prevUrl = null, nextUrl = null, canonical } = {}) {
  return '<link rel="canonical" href="' + B.esc(canonical) + '">' +
    (prevUrl ? '<link rel="prev" href="' + B.esc(abs(prevUrl)) + '">' : '') +
    (nextUrl ? '<link rel="next" href="' + B.esc(abs(nextUrl)) + '">' : '');
}
