// Blue River Live: the ONE source of the stream's words and markup.
//
// Used three ways, so nothing can drift:
//   - functions/_shared/render.js (the Pages Function that server-renders
//     /live/ and /live/page/<n>/) imports it and calls core(basics()).
//   - base.njk inlines basics() on every page (window.brgLive's URL and
//     video helpers: the banner uses them).
//   - live.njk inlines core() (window.brgCore): the client builds cards it
//     adds itself (top-ups, Load More, the no-SSR fallback) from the very same
//     string templates, then hydrates them exactly like server-rendered ones.
// The two factories are inlined by their source text (fn.toString()), so they
// are self-contained: no imports, no outer variables, ES5 syntax.
//
// Markup contract (classes are what main.css and the hydration read):
//   li.ls-day[data-t]                         > span.ls-node + span.ls-day-label
//   li.ls-post.is-left|is-right#ls-<n>[data-id][data-t][data-town][data-taken]
//     > span.ls-node + article.ls-card > div.live-media
//         > div.live-strip > (a.live-slide[href=full] | div.live-slide.is-video[data-mp4][data-poster][data-duration])
//             > img (+ a.live-play[href=mp4] > span.live-glyph, span.live-dur)
//         + button.live-count + span.live-chip
//       + div.ls-body > h3.ls-head[data-t][data-town] + p.ls-sub > time[data-posted] + p.ls-comment
//   li.ls-hook[data-kind]                     > span.ls-node + p.ls-hook-text
//   li.ls-spot[data-spot=form|form2]          empty; the page moves its forms in
//   li.ls-newer / li.ls-older                 archive links on the rail
// Text from the feed always goes through esc(); URLs through safe().
/* eslint-disable no-var */

function basics() {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Only https (or same-site) URLs from the feed ever reach src/href.
  function safe(u) { return typeof u === 'string' && (/^https:\/\//i.test(u) || /^\/(?!\/)/.test(u)) ? u : ''; }
  // Cloudinary thumb -> the small variant: drop the feed's own transforms
  // (c_limit,w_500,…), keep v<version>/<public_id>, use w_200,f_auto,q_auto.
  // A video's poster (…/video/upload/…/<id>.jpg) stays a jpg (f_jpg) and the
  // first frame (so_0). Other hosts pass through unchanged.
  function small(u) {
    var m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/)(.+)$/.exec(safe(u));
    if (!m) return safe(u);
    if (m[2] === 'video' && !/\.jpe?g$/i.test(m[3])) return safe(u);
    var parts = m[3].split('/');
    while (parts.length > 1 && /^[a-z]{1,3}_[^,]+(,[a-z]{1,3}_[^,]+)*$/.test(parts[0])) parts.shift();
    return m[1] + (m[2] === 'video' ? 'w_200,so_0,f_jpg,q_auto/' : 'w_200,f_auto,q_auto/') + parts.join('/');
  }
  // Video entries in photos[]: { kind: "video", duration, mp4, poster, thumb, w, h }.
  // Only one with a safe mp4 is playable; otherwise it is just its poster.
  // still() is the jpg every surface shows (the thumb, else the poster).
  function isVideo(x) { return !!(x && x.kind === 'video' && safe(x.mp4)); }
  function still(x) { return x ? safe(x.thumb) || (x.kind === 'video' ? safe(x.poster) : '') : ''; }
  // Seconds (or "m:ss") -> whole seconds, or NaN.
  function secs(v) {
    if (typeof v === 'string' && /^\d{1,3}:[0-5]\d$/.test(v)) { var p = v.split(':'); return +p[0] * 60 + +p[1]; }
    return typeof v === 'number' && isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : NaN;
  }
  // The duration chip: 23 -> "0:23", 83.4 -> "1:23"; junk -> "".
  function dur(v) { var s = secs(v); return isNaN(s) ? '' : Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function isLive(t, now) { return (now == null ? Date.now() : now) - Date.parse(t) < 86400000; }
  return { esc: esc, safe: safe, small: small, isVideo: isVideo, still: still, secs: secs, dur: dur, isLive: isLive };
}

function core(B) {
  var HOUR = 3600000, DAY = 86400000, HOOK_EVERY = 4, FORM_AFTER = 2, FORM2_AFTER = 6, EAGER = 4;
  var BOOK = 'https://BlueRiverGutters.as.me/', TEL = 'tel:2566166760';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var esc = B.esc;

  // ---------------------------------------------------------------- time
  // America/Chicago wall time by arithmetic (US rules: CDT from the 2nd
  // Sunday of March 2am to the 1st Sunday of November 2am, else CST). A
  // time-zone Intl formatter costs ~70ms to build on a slow phone, right in
  // the first render; this costs nothing. The tests check it against Intl.
  function sunday(y, m, from) { var d = new Date(Date.UTC(y, m, from)).getUTCDay(); return from + (7 - d) % 7; }
  function local(t) {
    var ms = typeof t === 'number' ? t : Date.parse(t), y = new Date(ms).getUTCFullYear();
    var cdt = ms >= Date.UTC(y, 2, sunday(y, 2, 8), 8) && ms < Date.UTC(y, 10, sunday(y, 10, 1), 7);
    return new Date(ms - (cdt ? 5 : 6) * HOUR);
  }
  function parts(t) {
    var d = local(t), y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
    return { n: Date.UTC(y, m, dd) / DAY, hour: d.getUTCHours(), min: d.getUTCMinutes(), y: y, m: m, d: dd, wd: d.getUTCDay(), key: y + '-' + (m + 1) + '-' + dd };
  }
  function daysAgo(t, now) { return parts(now).n - parts(t).n; }
  function partOfDay(t) { var h = parts(t).hour; return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
  function weekday(t) { return WEEKDAYS[parts(t).wd]; }
  function date(t, now) {
    var p = parts(t);
    return MONTHS[p.m] + ' ' + p.d + (p.y !== parts(now == null ? Date.now() : now).y ? ', ' + p.y : '');
  }
  // The factual clock for server-rendered stamps: "Nov 17, 2:41 PM".
  function clock(t, now) {
    var p = parts(t), h = p.hour % 12 || 12;
    return date(t, now) + ', ' + h + ':' + ('0' + p.min).slice(-2) + ' ' + (p.hour < 12 ? 'AM' : 'PM');
  }
  function tier(t, now) {
    now = now == null ? Date.now() : now;
    var age = now - Date.parse(t), d = daysAgo(t, now);
    if (age < HOUR && d <= 0) return 'fresh';
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return 'week';
    return 'older';
  }
  function at(town) { return town ? ' in ' + town : ''; }
  // The big red line, present tense, by AGE TIER (k picks the variant, so
  // neighbours never repeat). Never "right now", never invented activity.
  function headline(p, now, k) {
    now = now == null ? Date.now() : now; k = k || 0;
    var t = p.posted_at, town = (p.town || '').trim(), tr = tier(t, now), v;
    if (tr === 'fresh') v = [
      'Fresh off the ladder' + at(town),
      'Minutes ago' + at(town),
      town ? 'Just in from ' + town : 'Just in from the field'];
    else if (tr === 'today') v = [
      'Today' + at(town),
      'This ' + partOfDay(t) + at(town),
      'Earlier today' + at(town)];
    else if (tr === 'yesterday') v = [
      'Yesterday' + at(town),
      'Yesterday ' + partOfDay(t) + at(town)];
    else if (tr === 'week') v = [weekday(t) + at(town)];
    else v = [date(t, now) + at(town)];
    return v[k % v.length];
  }
  // The server's factual stamp in the same box: "Decatur · Nov 17, 2:41 PM".
  function stamp(p, now) {
    var town = (p.town || '').trim(), c = clock(p.posted_at, now);
    return town ? town + ' · ' + c : c;
  }
  function dayLabel(t, now) {
    now = now == null ? Date.now() : now;
    var d = daysAgo(t, now);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? weekday(t) : date(t, now);
  }
  // Same words as brgLive.rel() (the 15s ticker rewrites with that), without
  // its time-zone formatter for posts over a week old.
  function ago(t, now) {
    now = now == null ? Date.now() : now;
    var m = Math.floor(Math.max(0, now - Date.parse(t)) / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : h < 24 ? h + (h === 1 ? ' hr' : ' hrs') + ' ago' : d < 7 ? d + (d === 1 ? ' day' : ' days') + ' ago' : date(t, now);
  }
  function dayKey(t) { return parts(t).key; }

  // ---------------------------------------------------------------- words
  // The keyword map: what the post's comment says it was. Hooks (the
  // crew-voiced line after a post) and alt text both read it.
  var KINDS = [
    ['clean', /clean|clog|debris|leaves|pine|gunk|flush|full/i, [
      'Gutters like these fill up fast around here. Yours could be next on the list — ',
      'That’s what a clean-out looks like. Want your gutters flowing again? '], 'Gutter cleaning'],
    ['guard', /guard|screen|cover|leaf ?filter/i, [
      'Guards on and done. Tired of climbing a ladder every fall? We’ll look at yours — ',
      'One less fall chore for that homeowner. Want guards priced for your roof? '], 'Gutter guards'],
    ['seamless', /seamless|new gutter|install|6.?inch|5.?inch|k-style|run/i, [
      'Fresh seamless run, measured and formed on site. Want yours measured? ',
      'New gutters, no seams to leak. Free inspection for yours — '], 'Seamless gutters'],
    ['drain', /downspout|drain|underground|french|splash|pooling|foundation/i, [
      'Water headed where it belongs. Pooling by your foundation? We’ll take a look — ',
      'Downspouts sorted. If water’s sitting by your house, let’s fix that — '], 'Drainage work'],
    ['wood', /wood|fascia|rot|soffit|trim/i, [
      'Rotten fascia doesn’t fix itself. We’ll check yours on the same visit — '], 'Wood rot repair']
  ];
  function kindOf(c) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(c || '')) return KINDS[i];
    return null;
  }
  function hook(p, k) {
    k = k || 0;
    var town = (p.town || '').trim(), kd = kindOf(p.comment);
    if (kd) return { kind: kd[0], text: kd[2][k % kd[2].length] };
    if (town) {
      var v = [
        'That’s a ' + town + ' roofline. Yours could be next — we’re booking this week. ',
        'Another one done in ' + town + '. Free estimates this week — ',
        'Live near ' + town + '? The crew’s already in the neighborhood. '];
      return { kind: 'town', text: v[k % v.length] };
    }
    return { kind: 'generic', text: 'This could be your house — free estimates across Huntsville & North Alabama. ' };
  }
  // What the work was, for alt text: the kind's service; drainage that's
  // really about downspouts says so. Nothing matched: "Gutter work".
  function service(p) {
    var kd = kindOf(p.comment);
    if (!kd) return 'Gutter work';
    if (kd[0] === 'drain' && /downspout|splash/i.test(p.comment)) return 'Downspouts';
    return kd[3];
  }
  // Alt text for every post image (server and client):
  //   "{Service} in {Town}, AL — {caption}" (+ " (photo 2 of 3)" in a batch)
  function alt(p, x, i, n) {
    var town = (p.town || '').trim(), s = service(p) + (town ? ' in ' + town + ', AL' : '');
    if (p.comment) s += ' — ' + p.comment;
    if (n > 1) s += ' (' + (x && x.kind === 'video' ? 'video' : 'photo') + ' ' + (i + 1) + ' of ' + n + ')';
    return s;
  }

  // A sentence with life, or nothing. Today first (towns by most posts,
  // newest first on ties); else a strong week; else blank.
  function stats(posts, now) {
    now = now == null ? Date.now() : now;
    function towns(list) {
      var seen = {}, out = [];
      list.forEach(function (p) {
        var t = (p.town || '').trim(), k = t.toLowerCase();
        if (!t) return;
        if (!seen[k]) { seen[k] = { name: t, n: 0, i: out.length }; out.push(seen[k]); }
        seen[k].n++;
      });
      return out.sort(function (a, b) { return b.n - a.n || a.i - b.i; }).map(function (x) { return x.name; });
    }
    var today = posts.filter(function (p) { return daysAgo(p.posted_at, now) <= 0; }), tt = towns(today);
    if (tt.length === 1) return 'The crew’s been in ' + tt[0] + ' today';
    if (tt.length === 2) return 'The crew’s been in ' + tt[0] + ' and ' + tt[1] + ' today';
    if (tt.length > 2) return 'The crew’s been in ' + tt[0] + ', ' + tt[1] + ' and ' + (tt.length - 2) + ' more town' + (tt.length - 2 === 1 ? '' : 's') + ' today';
    var week = posts.filter(function (p) { return now - Date.parse(p.posted_at) < 7 * DAY; }), wt = towns(week);
    var photos = week.reduce(function (a, p) { return a + Math.max(+p.count || 0, Array.isArray(p.photos) ? p.photos.length : 1); }, 0);
    if (photos >= 10 && wt.length >= 3) return 'This week the crew’s been in ' + wt[0] + ', ' + wt[1] + ' and ' + (wt.length - 2) + ' more town' + (wt.length - 2 === 1 ? '' : 's');
    return '';
  }

  // ---------------------------------------------------------------- markup
  // A post's media (photos and videos). The pre-batch feed shape (w, h,
  // thumb, full on the post itself) is a one-photo post.
  function photos(p) {
    var ph = Array.isArray(p.photos) ? p.photos : [{ id: p.id, w: p.w, h: p.h, thumb: p.thumb, full: p.full }];
    return ph.filter(function (x) { return x && B.still(x); });
  }
  function ok(p) { return !!(p && p.id != null && !isNaN(Date.parse(p.posted_at)) && photos(p).length); }
  function ratio(x) { var w = Math.round(+x.w) || 4, h = Math.round(+x.h) || 3; return { w: w, h: h }; }
  // The feed thumb is w_500; stream cards are ~530px (zigzag) to ~680px wide
  // on bigger screens, so offer a w_1000 too. Phones are told "170px" so they
  // keep the w_500 (same quality and bytes as before, LCP unchanged).
  function big(u) { return B.small(u).replace('/w_200,', '/c_limit,w_1000,'); }
  function attr(name, v) { return ' ' + name + '="' + esc(v) + '"'; }

  // st.img counts stream images: the first EAGER load at once (no loading
  // attribute; the first is fetchpriority high, it is the LCP), the rest lazy.
  function slide(p, x, i, n, st) {
    var vid = B.isVideo(x), d = vid ? B.dur(x.duration) : '', r = ratio(x), src = B.still(x), a = alt(p, x, i, n);
    var img = '<img' + attr('width', r.w) + attr('height', r.h);
    var k = st.img++;
    if (k === 0) img += ' fetchpriority="high"';
    else if (k >= EAGER) img += ' loading="lazy" decoding="async"';
    img += attr('alt', a);
    if (/^https:\/\/res\.cloudinary\.com\//.test(src)) img += attr('srcset', src + ' 500w, ' + big(src) + ' 1000w') + ' sizes="(max-width: 768px) 170px, (min-width: 1024px) 530px, 680px"';
    img += attr('src', src) + '>';
    var box = ' style="aspect-ratio: ' + r.w + ' / ' + r.h + '"';
    if (!vid) return '<a class="live-slide"' + attr('href', B.safe(x.full) || src) + ' target="_blank" rel="noopener"' + box + '>' + img + '</a>';
    // A playable video: the poster, a play control that is a real link to
    // the mp4 (without JS it opens and plays it; with JS a tap plays inline),
    // and the duration.
    var mp4 = B.safe(x.mp4);
    return '<div class="live-slide is-video"' + box + attr('data-mp4', mp4) + attr('data-poster', B.safe(x.poster) || src) + attr('data-duration', isNaN(B.secs(x.duration)) ? '' : B.secs(x.duration)) + '>' + img +
      '<a class="live-play"' + attr('href', mp4) + attr('aria-label', 'Play video' + (d ? ', ' + d : '') + ' — ' + a) + '><span class="live-glyph" aria-hidden="true"></span></a>' +
      '<span class="live-dur"' + (d ? '' : ' hidden') + '>' + esc(d) + '</span></div>';
  }

  // "+2 photos", "+1 video", or "+2 more" when the rest are mixed.
  function countLabel(ph, total) {
    var restV = ph.slice(1).filter(function (x) { return x.kind === 'video'; }).length, m = total - 1;
    var what = !restV ? 'photo' + (m === 1 ? '' : 's') : restV === ph.length - 1 && ph.length === total ? 'video' + (m === 1 ? '' : 's') : 'more';
    return { text: '+' + m + ' ' + what, label: 'Next ' + (restV ? 'item' : 'photo') + ' (' + total + ' in this post)' };
  }

  // One post. o: { n (1-based place in the stream: id ls-<n>, side),
  // side ('is-left'|'is-right', default from n), now, alive (client: the
  // present-tense headline; server: the factual stamp), st (image counter) }.
  function card(p, o) {
    var ph = photos(p), total = Math.max(+p.count || 0, ph.length), now = o.now == null ? Date.now() : o.now;
    var live = B.isLive(p.posted_at, now), town = (p.town || '').trim();
    var side = o.side || (o.n % 2 ? 'is-left' : 'is-right');
    var r0 = ratio(ph[0]), ar = Math.min(4 / 3, Math.max(3 / 4, r0.w / r0.h));
    var h = '<li class="ls-post ' + side + (live ? ' is-live' : '') + '"' + (o.id ? attr('id', o.id) : attr('id', 'ls-' + o.n)) + attr('data-id', p.id) +
      attr('data-t', p.posted_at) + attr('data-town', town) + (p.taken_at && !isNaN(Date.parse(p.taken_at)) ? attr('data-taken', p.taken_at) : '') + attr('data-count', total) + ' data-live-box>' +
      '<span class="ls-node" aria-hidden="true"></span><article class="ls-card"><div class="live-media">' +
      '<div class="live-strip" style="aspect-ratio: ' + ar + '">' + ph.map(function (x, i) { return slide(p, x, i, ph.length, o.st); }).join('') + '</div>';
    if (total > 1) { var c = countLabel(ph, total); h += '<button type="button" class="live-count"' + attr('aria-label', c.label) + '>' + esc(c.text) + '</button>'; }
    if (live) h += '<span class="live-chip"><span class="live-dot is-live"></span>LIVE</span>';
    h += '</div><div class="ls-body"><h3 class="ls-head"' + attr('data-t', p.posted_at) + attr('data-town', town) + '>' + esc(o.alive ? headline(p, now, o.k || 0) : stamp(p, now)) + '</h3>' +
      '<p class="ls-sub">Posted <time' + attr('datetime', p.posted_at) + attr('data-posted', p.posted_at) + '>' + esc(ago(p.posted_at, now)) + '</time>' +
      (p.taken_at && !isNaN(Date.parse(p.taken_at)) ? ' · taken ' + esc(date(p.taken_at, now)) : '') + '</p>' +
      (p.comment ? '<p class="ls-comment">' + esc(p.comment) + '</p>' : '') + '</div></article></li>';
    return h;
  }
  function day(p, now) {
    var lab = dayLabel(p.posted_at, now);
    return '<li class="ls-day' + (lab === 'Today' ? ' is-today' : '') + '"' + attr('data-t', p.posted_at) + '><span class="ls-node"></span><span class="ls-day-label">' + esc(lab) + '</span></li>';
  }
  function hookItem(p, k) {
    var hk = hook(p, k);
    return '<li class="ls-hook"' + attr('data-kind', hk.kind) + '><span class="ls-node"></span><p class="ls-hook-text">' + esc(hk.text) +
      '<a class="ls-hook-tel"' + attr('href', TEL) + '>Call (256) 616-6760</a> or <a class="ls-hook-book"' + attr('href', BOOK) + ' target="_blank" rel="noopener">book online</a></p></li>';
  }

  // The stream's order, item by item, continuing from state st (so Load
  // More and top-ups pick up where the page left off):
  //   a day node opens each day's run (and the part after the form);
  //   a hook follows post n when n % 4 == 0 — keyed to that post, never
  //   right before the form, only once another post follows;
  //   after post K the form goes (K: st.K).
  // Returns [{ type: 'day'|'hook'|'post'|'form', html, n, post }].
  function state(o) { return { count: 0, lastDay: null, hooks: 0, prev: null, img: 0, K: (o && o.K) || FORM_AFTER, now: o && o.now, alive: !!(o && o.alive) }; }
  function sequence(posts, st) {
    var out = [], seen = {};
    posts.forEach(function (p) {
      if (!ok(p) || seen[p.id]) return;
      seen[p.id] = 1;
      var before = st.count;
      if (before > 0 && before % HOOK_EVERY === 0 && before !== st.K) out.push({ type: 'hook', html: hookItem(st.prev, st.hooks++), n: before });
      if (before === st.K && before > 0) out.push({ type: 'form', n: before });
      st.count++;
      var dk = dayKey(p.posted_at);
      if (dk !== st.lastDay || before === st.K) out.push({ type: 'day', html: day(p, st.now), n: st.count, post: p });
      st.lastDay = dk;
      out.push({ type: 'post', html: card(p, { n: st.count, now: st.now, alive: st.alive, st: st }), n: st.count, post: p });
      st.prev = p;
    });
    return out;
  }

  // The server-rendered stream: everything between the shell's markers.
  // o: { pageNum, nextUrl, prevUrl, now }. Archive pages open with a link
  // back up; the stream ends on the rail at "Older work →" (or, on the last
  // archive page, the beginning). Empty spots mark where the page moves its
  // forms in; without JS they are empty and take no space.
  function stream(posts, o) {
    o = o || {};
    var st = state({ now: o.now == null ? Date.now() : o.now }), items = sequence(posts, st), h = '';
    if (o.pageNum > 1 && B.safe(o.prevUrl)) h += '<li class="ls-newer"><span class="ls-node" aria-hidden="true"></span><a class="ls-newer-link"' + attr('href', o.prevUrl) + '>← Newer work from the field</a></li>';
    items.forEach(function (it) { h += it.type === 'form' ? '<li class="ls-spot" data-spot="form"></li>' : it.html; });
    if (st.count >= st.K + FORM2_AFTER) h += '<li class="ls-spot" data-spot="form2"></li>';
    if (B.safe(o.nextUrl)) h += '<li class="ls-older"><span class="ls-node" aria-hidden="true"></span><a class="ls-older-link"' + attr('href', o.nextUrl) + '>' +
      '<span class="ls-older-kicker">That’s everything from this stretch — older work continues</span><span class="ls-older-cta">Older work →</span></a></li>';
    else if (o.pageNum > 1) h += '<li class="ls-older is-start"><span class="ls-node" aria-hidden="true"></span><p class="ls-older-link"><span class="ls-older-kicker">You’ve reached the beginning</span><span class="ls-older-cta">The first jobs we posted to Blue River Live</span></p></li>';
    return h;
  }

  return {
    tier: tier, headline: headline, stamp: stamp, clock: clock, hook: hook, stats: stats, dayLabel: dayLabel, date: date, ago: ago, dayKey: dayKey,
    service: service, alt: alt, kindOf: kindOf, photos: photos, ok: ok, card: card, day: day, hookItem: hookItem,
    state: state, sequence: sequence, stream: stream, countLabel: countLabel
  };
}

module.exports = {
  basics: basics,
  core: core,
  // For the templates: each factory's own source, inlined as-is.
  basicsSrc: basics.toString(),
  coreSrc: core.toString()
};
