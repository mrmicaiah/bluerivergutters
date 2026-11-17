// PLACEHOLDER — Abebe owns this file and replaces it whole. It exists so the
// SSR plumbing (functions/_shared/ssr.js) builds and its tests run before his
// module lands. Keep the two exports' contract; everything else is his.
//
// renderStream(posts, { pageNum, nextUrl, prevUrl }) -> HTML string
//   posts    one page of the public feed's posts (functions/_shared/feed.js
//            shape; video entries carry kind/mp4/poster), hidden posts and
//            overlong videos already removed
//   nextUrl  site path of the next (older) archive page, or null at the end
//            ("Older work →" links here); prevUrl the newer page or null
//   The HTML goes inside the shell's data-ssr-slot container, at
//   <!--brg-ssr:stream-->. Plain factual stamps (town + date); no <script>.
//
// renderHead(pageNum, { prevUrl, nextUrl, canonical }) -> HTML string
//   canonical  absolute URL of this page; prevUrl/nextUrl site paths or null
//   Must emit exactly one <link rel="canonical"> (the shell's own is removed
//   before injection) plus rel="prev"/rel="next" when given. Goes in <head>
//   at <!--brg-ssr:head-->.
const SITE = 'https://bluerivergutters.com';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function day(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });
}

function media(p, alt) {
  const img = '<img src="' + esc(p.thumb) + '" width="' + esc(p.w) + '" height="' + esc(p.h) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">';
  if (p.kind !== 'video') return img;
  return '<figure class="ls-video" data-mp4="' + esc(p.mp4) + '" data-poster="' + esc(p.poster) + '" data-duration="' + esc(p.duration) + '">' + img + '</figure>';
}

export function renderStream(posts, { nextUrl = null } = {}) {
  const items = posts.map((post) => {
    const when = day(post.taken_at || post.posted_at);
    const alt = 'Gutter work' + (post.town ? ' in ' + post.town : '') + (post.comment ? ': ' + post.comment : '');
    return '<li class="ls-post" data-post-id="' + esc(post.id) + '">' +
      '<p class="ls-stamp">' + esc([post.town, when].filter(Boolean).join(' · ')) + '</p>' +
      (post.comment ? '<p class="ls-caption">' + esc(post.comment) + '</p>' : '') +
      post.photos.map((p) => media(p, alt)).join('') +
      '</li>';
  });
  if (nextUrl) items.push('<li class="ls-older"><a href="' + esc(nextUrl) + '">Older work →</a></li>');
  return items.join('');
}

export function renderHead(pageNum, { prevUrl = null, nextUrl = null, canonical } = {}) {
  return '<link rel="canonical" href="' + esc(canonical) + '">' +
    (prevUrl ? '<link rel="prev" href="' + esc(SITE + prevUrl) + '">' : '') +
    (nextUrl ? '<link rel="next" href="' + esc(SITE + nextUrl) + '">' : '');
}
