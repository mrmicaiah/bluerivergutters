// Server-rendered Blue River Live: /live/, its archive /live/page/<n>/ and
// /live-sitemap.xml (functions/live/**, functions/live-sitemap.xml.js). Exports
// no onRequest handler, so Pages never turns this file into a route.
//
// A request takes the STATIC /live/ page from the build (env.ASSETS) as a
// shell, fills it with one page of posts and serves it — so the page stays
// live (a new post shows without a rebuild) and crawlers get real HTML.
//
// Shell markers (placed by the /live/ template):
//   <!--brg-ssr:head-->    inside <head>: replaced by renderHead(...). Any
//                          <link rel="canonical"> already in the shell is
//                          removed first, so the page has exactly one.
//   data-ssr-slot          an attribute on the stream container; becomes
//                          data-ssr-slot data-ssr-page="<n>" for hydration.
//   <!--brg-ssr:stream-->  inside that container: replaced by
//                          renderStream(posts, { pageNum, nextUrl, prevUrl }).
// Archive pages (n > 1) also get " — Page n" on <title> and og:title, and
// og:url set to their own URL.
//
// Pages. Page 1 is /live/ (/live/page/1/ 301s there). Each page holds
// PAGE_SIZE posts from functions/_shared/feed.js — the public feed's exact
// grouping, hidden-post exclusion and cursors. Page n is reached by walking
// pages 1..n-1 server-side; every page's data is cached 60s by its cursor,
// so a walk is mostly cache hits. Depth limit: MAX_PAGES (40 pages, 1200
// posts). The chain stops there — page 40 has no next link and /live/page/41/
// 404s — even if older posts exist; raise MAX_PAGES when Live gets that big
// (cold cost is up to 6 Cloudinary searches per page walked). A page past the
// end, or one that would be empty, 404s with the static 404 page.
//
// Freshness and caching: each page's HTML is cached 60s in caches.default
// (custom domain only), same story as /api/live/feed — a new post, edit or
// hide shows within ~1 minute. The sitemap is cached 1h.
//
// Failures never give a blank 200:
//   shell unreachable                 -> 503 (Retry-After), not cached
//   markers missing from the shell    -> /live/ as the shell (the client
//                                        renders it as before); archive 503
//   Cloudinary or the renderer fails  -> the same
import { buildPage, parseCursor } from './feed.js';
import { renderStream, renderHead } from './render.js';

export const SITE = 'https://bluerivergutters.com';
export const PAGE_SIZE = 30;
export const MAX_PAGES = 40;
const HTML_SECONDS = 60;
const DATA_SECONDS = 60;
const SITEMAP_SECONDS = 3600;
const HEAD_MARKER = '<!--brg-ssr:head-->';
const STREAM_MARKER = '<!--brg-ssr:stream-->';
const SLOT_ATTR = 'data-ssr-slot';

export const pagePath = (n) => (n === 1 ? '/live/' : '/live/page/' + n + '/');

const cacheStore = () => (typeof caches !== 'undefined' ? caches.default : null);

// One page's posts, cached 60s by its starting cursor.
async function pageAt(cursor, ctx) {
  const cache = cacheStore();
  const key = new Request(ctx.origin + '/__live-ssr/page?n=' + PAGE_SIZE + '&cursor=' + encodeURIComponent(cursor));
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const data = await buildPage(ctx.env, PAGE_SIZE, parseCursor(cursor));
  if (cache) {
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + DATA_SECONDS }
    })));
  }
  return data;
}

// Page n's posts (n >= 1), or null when the chain ends before it. A page
// past 1 with no posts counts as the end.
async function page(n, ctx) {
  let cursor = '';
  for (let i = 1; ; i++) {
    const data = await pageAt(cursor, ctx);
    if (i > 1 && !data.posts.length) return null;
    if (i === n) return data;
    if (!data.next) return null;
    cursor = data.next;
  }
}

// Is there a non-empty page after n (inside the depth limit)?
async function hasNext(n, data, ctx) {
  if (n >= MAX_PAGES || !data.next) return false;
  return (await pageAt(data.next, ctx)).posts.length > 0;
}

function context({ request, env, waitUntil }) {
  return { env, origin: new URL(request.url).origin, waitUntil: waitUntil || (() => {}) };
}

const html = (body, status, cacheControl, extra = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, ...extra }
});

export function redirect(origin, path) {
  return new Response(null, { status: 301, headers: { Location: origin + path, 'Cache-Control': 'public, max-age=3600' } });
}

function unavailable() {
  return html('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Blue River Live — back in a minute</title></head>' +
    '<body><h1>Blue River Live is back in a minute</h1><p>The newest job photos couldn\'t load just now. ' +
    'Try again shortly, or call us — <a href="/">Blue River Gutters</a>.</p></body></html>',
  503, 'no-store', { 'Retry-After': '60' });
}

export async function notFound(ctx) {
  try {
    const r = await ctx.env.ASSETS.fetch(new Request(ctx.origin + '/404.html'));
    if (r.ok) return html(await r.text(), 404, 'public, max-age=60');
  } catch {}
  return html('<!doctype html><title>Not found</title><h1>Page not found</h1><p><a href="/live/">Blue River Live</a></p>', 404, 'public, max-age=60');
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function inject(shell, n, posts, links) {
  const path = pagePath(n);
  const head = renderHead(n, { ...links, canonical: SITE + path });
  const stream = renderStream(posts, { pageNum: n, ...links });
  let out = shell.replace(/<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi, '');
  out = out.replace(HEAD_MARKER, () => head);
  out = out.replace(STREAM_MARKER, () => stream);
  out = out.replace(SLOT_ATTR, SLOT_ATTR + ' data-ssr-page="' + n + '"');
  if (n > 1) {
    const suffix = ' — Page ' + n;
    out = out.replace(/<title>([\s\S]*?)<\/title>/i, (m, t) => '<title>' + t + suffix + '</title>');
    out = out.replace(/(<meta\s+property="og:title"\s+content=")([^"]*)(")/i, (m, a, t, b) => a + t + escAttr(suffix) + b);
    out = out.replace(/(<meta\s+property="og:url"\s+content=")([^"]*)(")/i, (m, a, t, b) => a + escAttr(SITE + path) + b);
  }
  return out;
}

// GET /live/ (n = 1) or /live/page/<n>/.
export async function servePage(ctxIn, n) {
  const ctx = context(ctxIn);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES) return notFound(ctx);
  const path = pagePath(n);
  const cache = cacheStore();
  const cacheKey = new Request(ctx.origin + path);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let shell;
  try {
    const r = await ctx.env.ASSETS.fetch(new Request(ctx.origin + '/live/'));
    if (!r.ok) throw new Error('shell ' + r.status);
    shell = await r.text();
    if (!shell.trim()) throw new Error('shell empty');
  } catch (err) {
    console.error('LIVE SSR: no shell for ' + path + ':', err.message);
    return unavailable();
  }
  // Page 1 can always fall back to the plain shell: it's the client-rendered
  // page that ran before SSR. An archive page has nothing to fall back to.
  const fallback = (why) => {
    console.error('LIVE SSR ' + path + ' not rendered: ' + why);
    return n === 1 ? html(shell, 200, 'no-store') : unavailable();
  };
  if (!shell.includes(HEAD_MARKER) || !shell.includes(STREAM_MARKER) || !shell.includes(SLOT_ATTR)) return fallback('shell markers missing');

  let data, links;
  try {
    data = await page(n, ctx);
    if (!data) return notFound(ctx);
    links = { prevUrl: n > 1 ? pagePath(n - 1) : null, nextUrl: (await hasNext(n, data, ctx)) ? pagePath(n + 1) : null };
  } catch (err) {
    return fallback('Cloudinary: ' + err.message);
  }
  let body;
  try {
    body = inject(shell, n, data.posts, links);
  } catch (err) {
    return fallback('renderer: ' + err.message);
  }
  const response = html(body, 200, 'public, max-age=' + HTML_SECONDS);
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// GET /live-sitemap.xml: /live/ and every archive page that exists now.
export async function serveSitemap(ctxIn) {
  const ctx = context(ctxIn);
  const cache = cacheStore();
  const cacheKey = new Request(ctx.origin + '/live-sitemap.xml');
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const paths = ['/live/'];
  try {
    let data = await pageAt('', ctx);
    for (let n = 1; await hasNext(n, data, ctx); n++) {
      paths.push(pagePath(n + 1));
      data = await pageAt(data.next, ctx);
    }
  } catch (err) {
    console.error('LIVE SITEMAP unavailable:', err.message);
    return new Response('sitemap unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => '  <url><loc>' + SITE + p + '</loc><changefreq>' + (p === '/live/' ? 'hourly' : 'daily') + '</changefreq></url>\n').join('') +
    '</urlset>\n';
  const response = new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=' + SITEMAP_SECONDS }
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
