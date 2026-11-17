/* Blue River Live — the crew's posting page (/live/post/).
 *
 * Needs /js/service-area.js loaded first (window.BRG_SERVICE_AREA) for the
 * town list. No third-party scripts.
 *
 * TOKEN. Read from the URL fragment (#t=...): fragments never reach a server
 * log. Kept in localStorage so a home-screen launch without the fragment still
 * works. It is only ever sent in POST bodies to our own /api/live/* — never in
 * a URL, never to Cloudinary.
 *
 * UPLOAD. Per photo, in order, one at a time:
 *   POST /api/live/sign {token, params_to_sign} -> {signature, api_key, cloud_name, timestamp}
 *   POST https://api.cloudinary.com/v1_1/<cloud>/image/upload (XHR, for progress)
 * Signed params: folder "live/", tags "brg-live", the incoming size cap
 * c_limit,w_2000,h_2000,q_auto:good, and context town | taken_at | comment |
 * gps | batch. No timestamp is sent: the server picks one (so a phone clock that's
 * off can't get a photo refused) and the upload uses the RETURNED timestamp,
 * which the signature covers. Post stays disabled until a town is set. A failure on one photo doesn't stop the
 * rest; Post then retries only the failed ones. A 403 anywhere means the link
 * is dead: show the "link not valid" screen.
 *
 * BATCH. One press of Post = one post on the site: every photo in that press
 * carries the same context batch = b<unixms>-<4hex>. Retrying failed photos
 * reuses it, so a partial failure never splits a driveway into two posts; a
 * new selection gets a new one.
 * At most MAX_PER_POST (20) photos per post, matching the feed: a bigger
 * selection posts the first 20 and offers "Post the other N" afterwards as a
 * separate post — said up front, never split or uploaded silently.
 *
 * VIDEO (WO-0150). Same picker. Each video is gated before anything is signed:
 * over 95MB, over 30.0s (loadedmetadata on an off-DOM <video>), or length
 * unreadable -> turned down with its reason; never retried, never blocks the
 * rest. Accepted ones sign with resource_type "video" and the video cap
 * (c_limit,w_1280,h_1280,q_auto,vc_auto) and POST to /video/upload.
 *
 * MANAGE. A second view, "Manage posts" (Post stays the default on every
 * load). His full history from POST /api/live/list {token, cursor?, n}, hidden
 * posts included, paged with Load more; fetched on the first open of the view,
 * not per visit. One row per post (keyed by batch id): edit comment, change
 * town, Hide/Unhide via POST /api/live/update {token, id, comment?|town?|hidden?},
 * optimistic, with per-row Retry on failure. Per-photo Remove (delete for
 * good) stays inside the row as the mistake path; Hide is the everyday way to
 * pull a post. The public feed catches up within its 60s cache.
 *
 * CAPTURE CHAIN, per batch:
 *   taken_at  EXIF DateTimeOriginal (+ OffsetTimeOriginal when present).
 *             Missing -> omitted. Never the file date, never "now".
 *   gps       EXIF GPS, attached to that photo only (private: the server keeps
 *             it out of the feed). The phone's own location is never stored.
 *   town      photo GPS -> nearest service-area town (within MAX_TOWN_KM);
 *             else one-tap "Use my location" (offered, never automatic — he
 *             may be posting from home); else the picker, which remembers the
 *             last town. Always shown for confirmation.
 */
(function () {
  'use strict';

  var CLOUD = 'dxzw1zwez';
  var FOLDER = 'live/';
  var TAG = 'brg-live';
  var TRANSFORMATION = 'c_limit,w_2000,h_2000,q_auto:good';
  // Videos (WO-0150): the server signs exactly this cap for video uploads.
  var VIDEO_TRANSFORMATION = 'c_limit,w_1280,h_1280,q_auto,vc_auto';
  var MAX_VIDEO_SECONDS = 30;             // "over 30.0s" is turned down
  var MAX_VIDEO_BYTES = 95 * 1024 * 1024; // under Cloudinary's 100MB single-upload limit
  var VIDEO_META_TIMEOUT_MS = 15000;
  var MSG_TOO_LONG = 'Videos must be 30 seconds or less. Trim it and try again.';
  var MSG_TOO_LARGE = 'This video is too large to upload. Shoot it at 1080p (not 4K) or keep it shorter, and try again.';
  var MSG_UNREADABLE = 'Couldn\u2019t read this video, so it can\u2019t go up. Try a different one.';
  var MAX_TOWN_KM = 25;
  // The feed shows at most 20 photos per post; anything past that would upload
  // and never render. So one press of Post never carries more than 20.
  var MAX_PER_POST = 20;
  var EXIF_READ_BYTES = 256 * 1024;
  var LS_TOKEN = 'brgLiveToken';
  var LS_TOWN = 'brgLiveTown';
  var SS_REMOVED = 'brgLiveRemoved';

  // Rough town centres for the service-area towns (src/_data/serviceArea.js).
  // Only used to name the nearest town; a town missing here can still be
  // picked by hand.
  var CENTROIDS = {
    'Huntsville': [34.7304, -86.5861], 'Madison': [34.6993, -86.7483],
    'Harvest': [34.8556, -86.7508], 'Hazel Green': [34.9323, -86.5719],
    'Meridianville': [34.8515, -86.5722], 'New Hope': [34.5370, -86.3944],
    'New Market': [34.9101, -86.4278], 'Owens Cross Roads': [34.5884, -86.4589],
    'Paint Rock': [34.6609, -86.3283], 'Toney': [34.8968, -86.7272],
    'Brownsboro': [34.7465, -86.4444], 'Gurley': [34.7012, -86.3753],
    'Laceys Spring': [34.5020, -86.6214], 'Ardmore': [34.9918, -86.8467],
    'Elkmont': [34.9290, -86.9747], 'Athens': [34.8029, -86.9717],
    'Tanner': [34.7234, -86.9725], 'Decatur': [34.6059, -86.9833],
    'Trinity': [34.6068, -87.0884], 'Hartselle': [34.4434, -86.9353],
    'Somerville': [34.4731, -86.7983], 'Cullman': [34.1748, -86.8436],
    'Arab': [34.3281, -86.4958], 'Albertville': [34.2676, -86.2089],
    'Guntersville': [34.3582, -86.2947], 'Scottsboro': [34.6723, -86.0341]
  };

  // ---- storage (private mode / blocked storage must never break posting) --
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function removedIds() { try { return JSON.parse(sessionStorage.getItem(SS_REMOVED) || '[]'); } catch (e) { return []; } }
  function addRemoved(id) { try { var l = removedIds(); l.push(id); sessionStorage.setItem(SS_REMOVED, JSON.stringify(l)); } catch (e) {} }

  // ---- EXIF: just DateTimeOriginal (+offset) and GPS, from a JPEG ---------
  // Returns {} for anything it can't read — never throws.
  function readExif(buffer) {
    try {
      var v = new DataView(buffer);
      if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
      var off = 2;
      while (off + 4 <= v.byteLength) {
        if (v.getUint8(off) !== 0xFF) return {};
        var marker = v.getUint8(off + 1);
        if (marker === 0xFF) { off++; continue; }          // fill byte
        if (marker === 0xDA || marker === 0xD9) return {}; // image data: no EXIF before it
        var len = v.getUint16(off + 2);
        if (marker === 0xE1 && len >= 16 && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
          return parseTiff(v, off + 10, Math.min(off + 2 + len, v.byteLength));
        }
        off += 2 + len;
      }
    } catch (e) {}
    return {};
  }

  function parseTiff(v, start, end) {
    var le;
    var order = v.getUint16(start);
    if (order === 0x4949) le = true; else if (order === 0x4D4D) le = false; else return {};
    function u16(o) { if (o < start || o + 2 > end) throw new Error('oob'); return v.getUint16(o, le); }
    function u32(o) { if (o < start || o + 4 > end) throw new Error('oob'); return v.getUint32(o, le); }
    if (u16(start + 2) !== 42) return {};

    // tag -> {type, count, valueOffset (absolute, where the value lives)}
    function readIfd(rel) {
      var at = start + rel, n = u16(at), tags = {};
      for (var i = 0; i < n; i++) {
        var e = at + 2 + i * 12;
        var type = u16(e + 2), count = u32(e + 4);
        var size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 })[type] || 0;
        tags[u16(e)] = { type: type, count: count, at: size * count <= 4 ? e + 8 : start + u32(e + 8) };
      }
      return tags;
    }
    function ascii(t) {
      if (!t || t.type !== 2) return '';
      var s = '';
      for (var i = 0; i < t.count; i++) { if (t.at + i >= end) throw new Error('oob'); var c = v.getUint8(t.at + i); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    function dms(t) {
      if (!t || t.type !== 5 || t.count < 3) return NaN;
      var parts = [0, 1, 2].map(function (i) { var d = u32(t.at + i * 8 + 4); return d ? u32(t.at + i * 8) / d : NaN; });
      return parts[0] + parts[1] / 60 + parts[2] / 3600;
    }

    var out = {};
    var ifd0 = readIfd(u32(start + 4));
    if (ifd0[0x8769]) {
      try {
        var ex = readIfd(u32(ifd0[0x8769].at));
        var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(ex[0x9003]));
        if (m && m[1] !== '0000' && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
          var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
          var offset = ascii(ex[0x9011]);
          out.taken_at = /^[+-]\d{2}:\d{2}$/.test(offset) ? iso + offset : iso;
        }
      } catch (e) {}
    }
    if (ifd0[0x8825]) {
      try {
        var g = readIfd(u32(ifd0[0x8825].at));
        var lat = dms(g[2]), lng = dms(g[4]);
        if (ascii(g[1]) === 'S') lat = -lat;
        if (ascii(g[3]) === 'W') lng = -lng;
        if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
          out.gps = lat.toFixed(6) + ',' + lng.toFixed(6);
        }
      } catch (e) {}
    }
    return out;
  }

  function exifFromFile(file) {
    if (!file || !file.slice) return Promise.resolve({});
    var blob = file.slice(0, EXIF_READ_BYTES);
    var read = blob.arrayBuffer ? blob.arrayBuffer() : new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(blob);
    });
    return read.then(readExif, function () { return {}; });
  }

  // ---- towns --------------------------------------------------------------
  function towns() {
    var area = window.BRG_SERVICE_AREA || { prefixes: {}, zips: {} }, seen = {};
    [area.prefixes, area.zips].forEach(function (map) { for (var k in map) seen[map[k]] = true; });
    return Object.keys(seen).sort();
  }

  function km(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function nearestTown(lat, lng) {
    var best = null, bestKm = Infinity;
    towns().forEach(function (t) {
      if (!CENTROIDS[t]) return;
      var d = km([lat, lng], CENTROIDS[t]);
      if (d < bestKm) { bestKm = d; best = t; }
    });
    return bestKm <= MAX_TOWN_KM ? best : null;
  }

  // ---- Cloudinary context: key=value|key=value, with = and | escaped ------
  function escapeCtx(s) { return String(s).replace(/([\\=|])/g, '\\$1'); }
  function newBatchId() {
    var r;
    try { r = crypto.getRandomValues(new Uint16Array(1))[0]; } catch (e) { r = Math.floor(Math.random() * 65536); }
    return 'b' + Date.now() + '-' + ('000' + r.toString(16)).slice(-4);
  }

  function contextString(obj) {
    return Object.keys(obj).filter(function (k) { return obj[k] !== undefined && obj[k] !== ''; })
      .map(function (k) { return k + '=' + escapeCtx(obj[k]); }).join('|');
  }

  // ---- video gates: size, then duration, both before any upload -----------
  function isVideo(file) {
    return /^video\//.test(file.type || '') || /\.(mov|mp4|m4v|webm|3gp|qt)$/i.test(file.name || '');
  }

  // -> {ok: true, duration} | {ok: false, message}. Never throws. A video whose
  // length can't be read is turned down: nothing goes up unverified.
  function videoGate(file) {
    if (file.size > MAX_VIDEO_BYTES) return Promise.resolve({ ok: false, message: MSG_TOO_LARGE });
    return new Promise(function (resolve) {
      var v = document.createElement('video'), url = null, done = false;
      function finish(result) {
        if (done) return; done = true;
        clearTimeout(timer);
        v.onloadedmetadata = v.onerror = null;
        try { v.removeAttribute('src'); v.load(); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
        resolve(result);
      }
      var timer = setTimeout(function () { finish({ ok: false, message: MSG_UNREADABLE }); }, VIDEO_META_TIMEOUT_MS);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = function () {
        var d = v.duration;
        if (!isFinite(d) || !(d > 0)) return finish({ ok: false, message: MSG_UNREADABLE });
        if (d > MAX_VIDEO_SECONDS) return finish({ ok: false, message: MSG_TOO_LONG, duration: d });
        finish({ ok: true, duration: d });
      };
      v.onerror = function () { finish({ ok: false, message: MSG_UNREADABLE }); };
      try { url = URL.createObjectURL(file); v.src = url; } catch (e) { finish({ ok: false, message: MSG_UNREADABLE }); }
    });
  }

  // Tenths, rounded down: a 30.1s clip must never read as "30" next to the 30s rule.
  function clock(sec) { return (Math.floor(sec * 10) / 10).toFixed(1) + ' sec'; }

  window.BRGLivePost = {
    readExif: readExif, nearestTown: nearestTown, towns: towns, newBatchId: newBatchId,
    hasCentroid: function (t) { return !!CENTROIDS[t]; }, contextString: contextString,
    videoGate: videoGate, isVideo: isVideo
  };

  // ---- page -----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function init() {
    var app = $('lp-app');
    if (!app) return;
    var els = {
      invalid: $('lp-invalid'), files: $('lp-files'), items: $('lp-items'), compose: $('lp-compose'),
      town: $('lp-town'), townNote: $('lp-town-note'), locate: $('lp-locate'), comment: $('lp-comment'),
      post: $('lp-post'), error: $('lp-error'), success: $('lp-success'), successText: $('lp-success-text'),
      again: $('lp-again'), capNote: $('lp-cap-note'), recent: $('lp-recent'), recentEmpty: $('lp-recent-empty'),
      more: $('lp-more'), listError: $('lp-list-error'), listRetry: $('lp-list-retry'), listLoading: $('lp-list-loading')
    };

    // Token: fragment first (then remembered), else stored from an earlier visit.
    var m = /(?:^|[#&])t=([^&]+)/.exec(location.hash || '');
    var token = m ? decodeURIComponent(m[1]) : lsGet(LS_TOKEN);
    if (m) lsSet(LS_TOKEN, token);

    var dead = false;
    function linkDead() {
      dead = true;
      app.hidden = true;
      els.invalid.hidden = false;
    }
    if (!token) return linkDead();

    function api(path, body) {
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.status === 403) { linkDead(); throw new Error('forbidden'); }
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
            return d;
          });
        });
    }

    function baseParams(kind) {
      return { folder: FOLDER, tags: TAG, transformation: kind === 'video' ? VIDEO_TRANSFORMATION : TRANSFORMATION };
    }

    // Probe the link once on load so a dead link says so before he picks
    // photos. Signing creates nothing. A network failure here is not a verdict.
    app.hidden = false;
    api('/api/live/sign', { token: token, params_to_sign: baseParams() }).catch(function () {});

    // ---- town picker ------------------------------------------------------
    var townSource = '';   // 'photo' | 'device' | 'remembered' | 'picked'
    towns().forEach(function (t) {
      var o = document.createElement('option'); o.value = t; o.textContent = t; els.town.appendChild(o);
    });
    function setTown(t, source) {
      els.town.value = t || '';
      townSource = t ? source : '';
      var notes = { photo: 'From the photo location — change it if that’s wrong.', device: 'From your location just now.', remembered: 'Same as last time.', picked: '' };
      els.townNote.textContent = t ? (notes[townSource] || '') : 'Pick the town to post.';
      updatePostButton();
    }
    els.town.addEventListener('change', function () { setTown(els.town.value, 'picked'); clearError(); });

    els.locate.addEventListener('click', function () {
      if (!navigator.geolocation) { showError('This phone won’t share a location — pick the town instead.'); return; }
      els.locate.disabled = true;
      els.locate.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        els.locate.disabled = false; els.locate.textContent = 'Use my location';
        var t = nearestTown(pos.coords.latitude, pos.coords.longitude);
        if (t) { setTown(t, 'device'); clearError(); }
        else showError('You’re outside the service area — pick the town the job is in.');
      }, function () {
        els.locate.disabled = false; els.locate.textContent = 'Use my location';
        showError('Couldn’t get your location — pick the town instead.');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });

    // ---- picked photos ----------------------------------------------------
    var batch = [];   // {file, exif, el, state}
    var batchId = null; // set on the first Post press for this selection; kept for retries

    var leftover = [];  // picked past the 20-photo cap, waiting for "Post the other N"
    var carried = false; // the comment field still holds the last job's comment, kept for its leftover

    els.files.addEventListener('change', function () {
      var files = Array.prototype.slice.call(els.files.files || []);
      if (!files.length) return;
      // A fresh pick instead of "Post the other N" is a new job: drop the
      // comment that was only kept for the leftover.
      if (carried) { els.comment.value = ''; carried = false; }
      loadSelection(files);
    });

    function loadSelection(files) {
      resetBatch();
      leftover = files.slice(MAX_PER_POST);
      files = files.slice(0, MAX_PER_POST);
      if (leftover.length) {
        els.capNote.textContent = MAX_PER_POST + ' photos per post \u2014 posting the first ' + MAX_PER_POST +
          ' now. The other ' + leftover.length + ' go up next as their own post.';
        els.capNote.hidden = false;
      } else {
        els.capNote.hidden = true;
      }
      els.success.hidden = true;
      els.compose.hidden = false;
      files.forEach(function (file) {
        var video = isVideo(file);
        var item = { file: file, kind: video ? 'video' : 'photo', exif: {}, state: video ? 'checking' : 'ready' };
        item.el = renderItem(item);
        batch.push(item);
      });
      var mine = batch;
      Promise.all(batch.map(function (item) {
        if (item.kind === 'video') {
          return videoGate(item.file).then(function (g) {
            if (batch !== mine) return;
            var when = item.el.querySelector('.lp-item-when');
            if (g.ok) {
              when.textContent = 'Video \u00b7 ' + clock(g.duration);
              setState(item, 'ready', 'Ready');
            } else {
              when.textContent = g.duration ? 'Video \u00b7 ' + clock(g.duration) : 'Video';
              setState(item, 'refused', 'Turned down');
              item.el.querySelector('.lp-item-msg').textContent = g.message;
              item.el.querySelector('.lp-item-msg').hidden = false;
            }
            updatePostButton();
          });
        }
        return exifFromFile(item.file).then(function (exif) {
          item.exif = exif;
          if (exif.taken_at) item.el.dataset.takenAt = exif.taken_at;
          if (exif.gps) item.el.dataset.gps = exif.gps;
          var when = item.el.querySelector('.lp-item-when');
          when.textContent = exif.taken_at ? 'Taken ' + shortDate(exif.taken_at) : 'No photo date';
        });
      })).then(function () { if (batch === mine) chooseTown(); });
      updatePostButton();
    }

    function chooseTown() {
      var fromPhoto = null;
      batch.some(function (item) {
        if (!item.exif.gps) return false;
        var ll = item.exif.gps.split(',');
        fromPhoto = nearestTown(+ll[0], +ll[1]);
        return !!fromPhoto;
      });
      if (fromPhoto) return setTown(fromPhoto, 'photo');
      var last = lsGet(LS_TOWN);
      if (last && towns().indexOf(last) !== -1) return setTown(last, 'remembered');
      setTown('', '');
    }

    function renderItem(item) {
      var li = document.createElement('li');
      li.className = 'lp-item';
      li.dataset.state = item.state;
      li.dataset.kind = item.kind;
      var img;
      if (item.kind === 'video') {
        // A tile, not a decoded frame: the gate reads only metadata.
        img = document.createElement('span'); img.className = 'lp-item-vid'; img.setAttribute('aria-hidden', 'true'); img.textContent = '\u25b6';
      } else {
        img = document.createElement('img');
        img.alt = '';
        try { img.src = URL.createObjectURL(item.file); } catch (e) {}
        img.onerror = function () { img.style.visibility = 'hidden'; };
      }
      var meta = document.createElement('div'); meta.className = 'lp-item-meta';
      var when = document.createElement('span'); when.className = 'lp-item-when'; when.textContent = item.kind === 'video' ? 'Checking video\u2026' : 'Reading\u2026';
      var status = document.createElement('span'); status.className = 'lp-item-status'; status.textContent = item.kind === 'video' ? 'Checking' : 'Ready';
      var bar = document.createElement('progress'); bar.className = 'lp-progress'; bar.max = 100; bar.value = 0;
      var msg = document.createElement('p'); msg.className = 'lp-item-msg'; msg.setAttribute('role', 'status'); msg.hidden = true;
      meta.appendChild(when); meta.appendChild(status); meta.appendChild(bar); meta.appendChild(msg);
      li.appendChild(img); li.appendChild(meta);
      els.items.appendChild(li);
      return li;
    }

    function setState(item, state, text, pct) {
      item.state = state;
      item.el.dataset.state = state;
      item.el.querySelector('.lp-item-status').textContent = text;
      if (pct !== undefined) item.el.querySelector('.lp-progress').value = pct;
    }

    function resetBatch() {
      batch.forEach(function (item) { var img = item.el.querySelector('img'); if (img) { try { URL.revokeObjectURL(img.src); } catch (e) {} } });
      batch = [];
      batchId = null;
      els.items.textContent = '';
      clearError();
    }

    // Turned-down videos are never pending: nothing to retry, nothing to send.
    function pending() { return batch.filter(function (i) { return i.state !== 'done' && i.state !== 'refused'; }); }
    function checking() { return batch.some(function (i) { return i.state === 'checking'; }); }

    // "3 photos", "2 videos", "2 photos + 1 video"
    function describe(items, joiner) {
      var p = 0, v = 0;
      items.forEach(function (i) { if (i.kind === 'video') v++; else p++; });
      var parts = [];
      if (p) parts.push(p + (p > 1 ? ' photos' : ' photo'));
      if (v) parts.push(v + (v > 1 ? ' videos' : ' video'));
      return parts.join(joiner);
    }

    function updatePostButton() {
      var failed = batch.filter(function (i) { return i.state === 'failed'; }).length;
      var todo = pending();
      els.post.disabled = !todo.length || posting || !els.town.value || checking();
      if (failed) els.post.textContent = 'Retry ' + failed + ' failed';
      else if (checking()) els.post.textContent = 'Checking video\u2026';
      else els.post.textContent = todo.length > 1 ? 'Post ' + describe(todo, ' + ') : 'Post';
    }

    function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
    function clearError() { els.error.textContent = ''; els.error.hidden = true; }

    // ---- posting -----------------------------------------------------------
    var posting = false;

    els.post.addEventListener('click', function () {
      if (posting || dead || checking()) return;
      clearError();
      var todo = pending();
      if (!todo.length) return;
      var town = els.town.value;
      if (!town) { showError('Pick the town first.'); els.town.focus(); return; }
      lsSet(LS_TOWN, town);
      var comment = els.comment.value.trim();
      if (!batchId) batchId = newBatchId();
      var thisBatch = batchId;
      posting = true;
      els.compose.classList.add('lp-busy');
      updatePostButton();

      todo.reduce(function (chain, item) {
        return chain.then(function () { if (!dead) return postOne(item, town, comment, thisBatch); });
      }, Promise.resolve()).then(function () {
        posting = false;
        els.compose.classList.remove('lp-busy');
        if (dead) return;
        updatePostButton();
        var failed = batch.filter(function (i) { return i.state === 'failed'; }).length;
        if (failed) { showError(failed + (failed > 1 ? ' photos' : ' photo') + ' didn’t go up. Check signal and tap Retry.'); return; }
        var sent = batch.filter(function (i) { return i.state === 'done'; });
        var refused = batch.length - sent.length;
        els.successText.textContent = 'Posted ' + describe(sent, ' and ') + ' to ' + town + '.' +
          (refused ? ' ' + refused + (refused > 1 ? ' videos were' : ' video was') + ' turned down.' : '');
        els.again.textContent = leftover.length ? 'Post the other ' + leftover.length : 'Post more';
        els.success.hidden = false;
        els.compose.hidden = true;
        els.capNote.hidden = true;
        if (leftover.length) carried = true;  // the rest of the same job keeps its comment
        else els.comment.value = '';
        els.files.value = '';
      });
    });

    function postOne(item, town, comment, batchKey) {
      var ctx = { town: town, batch: batchKey };
      if (item.exif.taken_at) ctx.taken_at = item.exif.taken_at;
      if (comment) ctx.comment = comment;
      if (item.exif.gps) ctx.gps = item.exif.gps;
      var params = baseParams(item.kind);
      params.context = contextString(ctx);
      setState(item, 'signing', 'Starting…', 0);
      // sign.js checks the transformation against the resource type; image is its default.
      var signBody = { token: token, params_to_sign: params };
      if (item.kind === 'video') signBody.resource_type = 'video';
      return api('/api/live/sign', signBody).then(function (sig) {
        // The signature covers the server's timestamp: upload with exactly that.
        if (!sig.timestamp || !sig.signature) throw new Error('bad sign response');
        params.timestamp = sig.timestamp;
        return upload(item, params, sig);
      }).then(function (res) {
        setState(item, 'done', 'Posted', 100);
        addJustPosted({ id: res.public_id, batch: batchKey, kind: item.kind, thumb: item.kind === 'video' ? posterUrl(res.secure_url) : thumbUrl(res.secure_url), town: town, taken_at: item.exif.taken_at || null, posted_at: new Date().toISOString(), comment: comment || null });
      }, function (err) {
        if (dead) return;
        setState(item, 'failed', 'Failed', 0);
      });
    }

    function upload(item, params, sig) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        fd.append('file', item.file);
        fd.append('api_key', sig.api_key);
        Object.keys(params).forEach(function (k) { fd.append(k, params[k]); });
        fd.append('signature', sig.signature);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + (sig.cloud_name || CLOUD) + (item.kind === 'video' ? '/video/upload' : '/image/upload'));
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) setState(item, 'uploading', Math.round(e.loaded / e.total * 100) + '%', Math.min(99, Math.round(e.loaded / e.total * 100)));
        };
        xhr.onload = function () {
          var data = {};
          try { data = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && data.public_id) resolve(data);
          else reject(new Error((data.error && data.error.message) || ('HTTP ' + xhr.status)));
        };
        xhr.onerror = function () { reject(new Error('network')); };
        setState(item, 'uploading', 'Uploading…', 1);
        xhr.send(fd);
      });
    }

    els.again.addEventListener('click', function () {
      if (leftover.length) {   // same job: same town (remembered) and comment
        carried = false;
        els.success.hidden = true;
        els.compose.hidden = false;
        loadSelection(leftover);
        return;
      }
      resetBatch();
      els.success.hidden = true;
      els.compose.hidden = true;
      updatePostButton();
      els.files.click();
    });

    // ---- recent posts -----------------------------------------------------
    function thumbUrl(u) { return String(u || '').replace('/image/upload/', '/image/upload/w_300,h_300,c_fill,f_auto,q_auto/'); }
    // A just-uploaded video's poster: its first frame as a JPEG.
    function posterUrl(u) { return String(u || '').replace('/video/upload/', '/video/upload/so_0,w_300,h_300,c_fill,q_auto/').replace(/\.[a-z0-9]+$/i, '.jpg'); }

    function shortDate(iso) {
      var mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
      if (!mm) return '';
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mm[2] - 1] + ' ' + (+mm[3]);
    }
    function ago(iso) {
      var t = Date.parse(iso);
      if (!isFinite(t)) return '';
      var s = Math.max(0, (Date.now() - t) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + (s < 7200 ? ' hr ago' : ' hrs ago');
      return Math.floor(s / 86400) + (s < 172800 ? ' day ago' : ' days ago');
    }

    // ---- views: Post (default, always on load) | Manage posts --------------
    var tabs = { post: $('lp-tab-post'), manage: $('lp-tab-manage') };
    var views = { post: $('lp-view-post'), manage: $('lp-view-manage') };
    var listed = false;   // the first page is fetched on the first open of Manage, not per visit
    function showView(name) {
      if (dead) return;
      Object.keys(views).forEach(function (k) {
        views[k].hidden = k !== name;
        tabs[k].setAttribute('aria-selected', k === name ? 'true' : 'false');
      });
      window.scrollTo(0, 0);
      if (name === 'manage' && !listed) { listed = true; loadList(null); }
    }
    tabs.post.addEventListener('click', function () { showView('post'); });
    tabs.manage.addEventListener('click', function () { showView('manage'); });

    // ---- manage: one row per post -------------------------------------------
    // Its key is the batch id, which is also the post id the server knows; a
    // pre-batch photo's post id is its own public_id. Edits, Hide and Unhide
    // go to /api/live/update {token, id, comment?|town?|hidden?} and apply to
    // the whole post. They show at once (optimistic); a failure keeps what he
    // set, marks the row, and Retry resends the whole unsaved change.
    var LIST_N = 12;
    var recs = {};   // post key -> {comment, town, hidden, pending, inflight}
    var FIELDS = ['comment', 'town', 'hidden'];

    function postKey(p) { return p.batch || p.id; }
    function findRow(key) { return els.recent.querySelector(':scope > .lp-entry[data-batch="' + CSS.escape(key) + '"]'); }
    function hasPhoto(id) { return !!els.recent.querySelector('.lp-photos [data-id="' + CSS.escape(id) + '"]'); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
    function btn(cls, text) { var b = el('button', cls, text); b.type = 'button'; return b; }

    function townOptions(select, current) {
      select.textContent = '';
      var list = towns();
      if (current && list.indexOf(current) === -1) list = [current].concat(list);
      list.forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; select.appendChild(o); });
      select.value = current || '';
    }

    function makeRow(p) {
      var key = postKey(p);
      recs[key] = { comment: p.comment || '', town: p.town || '', hidden: !!p.hidden, taken_at: p.taken_at, posted_at: p.posted_at, pending: null, inflight: false };
      var li = el('li', 'lp-entry');
      li.dataset.batch = key;
      li.dataset.state = '';

      var top = el('div', 'lp-row-top');
      var cover = el('div', 'lp-cover');
      var img = el('img'); img.alt = ''; img.loading = 'lazy'; img.width = 64; img.height = 64;
      var count = el('span', 'lp-count'); count.hidden = true;
      cover.appendChild(img); cover.appendChild(count);
      var meta = el('div', 'lp-recent-meta');
      var line = el('strong', 'lp-meta-line');
      line.appendChild(el('span', 'lp-meta-town'));
      line.appendChild(el('span', 'lp-meta-when'));
      meta.appendChild(line);
      meta.appendChild(el('span', 'lp-meta-comment'));
      meta.appendChild(el('span', 'lp-badge', 'Hidden from the site'));
      top.appendChild(cover); top.appendChild(meta);

      var actions = el('div', 'lp-actions');
      var edit = btn('lp-edit', 'Edit');
      var hide = btn('lp-hide', 'Hide');
      var expand = btn('lp-expand');
      actions.appendChild(edit); actions.appendChild(hide); actions.appendChild(expand);

      var statusRow = el('div', 'lp-status-row');
      var status = el('p', 'lp-status'); status.setAttribute('aria-live', 'polite');
      var retry = btn('lp-retry', 'Retry'); retry.hidden = true;
      statusRow.appendChild(status); statusRow.appendChild(retry);

      var editor = el('div', 'lp-editor'); editor.hidden = true;
      var cLabel = el('label', 'lp-label', 'Comment');
      var cInput = el('textarea', 'lp-edit-comment'); cInput.maxLength = 280; cInput.rows = 2;
      var tLabel = el('label', 'lp-label', 'Town');
      var tSelect = el('select', 'lp-edit-town');
      var uid = 'e' + Math.random().toString(36).slice(2, 8);
      cInput.id = uid + 'c'; cLabel.htmlFor = cInput.id; tSelect.id = uid + 't'; tLabel.htmlFor = tSelect.id;
      var eActions = el('div', 'lp-editor-actions');
      var save = btn('lp-save', 'Save'); var cancel = btn('lp-cancel', 'Cancel');
      eActions.appendChild(save); eActions.appendChild(cancel);
      [cLabel, cInput, tLabel, tSelect, eActions].forEach(function (n) { editor.appendChild(n); });

      var wrap = el('div', 'lp-photos-wrap'); wrap.hidden = true;
      wrap.appendChild(el('p', 'lp-remove-note', 'Remove deletes one photo for good — only for a mistake (wrong photo, a face, a house number or plate). To take a post off the site, use Hide.'));
      var photos = el('ul', 'lp-photos');
      wrap.appendChild(photos);

      [top, actions, statusRow, editor, wrap].forEach(function (n) { li.appendChild(n); });

      edit.addEventListener('click', function () {
        if (!editor.hidden) { editor.hidden = true; refreshRow(li); return; }
        var r = recs[key];
        cInput.value = r.comment;
        townOptions(tSelect, r.town);
        editor.hidden = false;
        refreshRow(li);
        cInput.focus();
      });
      cancel.addEventListener('click', function () { editor.hidden = true; refreshRow(li); });
      save.addEventListener('click', function () {
        var r = recs[key], patch = {}, any = false;
        var c = cInput.value.trim();
        if (c !== r.comment) { patch.comment = c; any = true; }
        if (tSelect.value && tSelect.value !== r.town) { patch.town = tSelect.value; any = true; }
        editor.hidden = true;
        if (any) change(li, patch); else refreshRow(li);
      });
      hide.addEventListener('click', function () { change(li, { hidden: !recs[key].hidden }); });
      retry.addEventListener('click', function () { if (!recs[key].inflight && recs[key].pending) sendChange(li); });
      expand.addEventListener('click', function () { wrap.hidden = !wrap.hidden; refreshRow(li); });
      return li;
    }

    function change(li, patch) {
      var r = recs[li.dataset.batch];
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      r.pending = Object.assign(r.pending || {}, patch);
      if (r.inflight) { refreshRow(li); return; }   // goes with the next send
      sendChange(li);
    }

    function sendChange(li) {
      var key = li.dataset.batch, r = recs[key];
      var sent = r.pending; r.pending = null; r.inflight = true;
      var body = { token: token, id: key };
      FIELDS.forEach(function (k) { if (k in sent) body[k] = sent[k]; });
      setRowState(li, 'saving', 'Saving…');
      api('/api/live/update', body).then(function () {
        r.inflight = false;
        if (r.pending) return sendChange(li);
        setRowState(li, 'saved', 'Saved. The live site catches up within a minute.');
        // Quiet: the note goes once he's had time to read it.
        setTimeout(function () { if (li.dataset.state === 'saved' && !r.inflight && !r.pending) setRowState(li, '', ''); }, 8000);
      }, function () {
        r.inflight = false;
        if (dead) return;
        r.pending = Object.assign({}, sent, r.pending || {});
        setRowState(li, 'failed', 'Didn’t save. Check signal and tap Retry.');
      });
    }

    function setRowState(li, state, text) {
      li.dataset.state = state;
      li.querySelector('.lp-status').textContent = text;
      li.querySelector('.lp-retry').hidden = state !== 'failed';
      refreshRow(li);
    }

    function refreshRow(li) {
      var wrap = li.querySelector('.lp-photos-wrap');
      var photos = li.querySelector('.lp-photos');
      var n = photos.children.length;
      if (!n) {   // the last photo out takes the post with it
        li.remove();
        els.recentEmpty.hidden = !!els.recent.children.length;
        return;
      }
      var r = recs[li.dataset.batch];
      var first = photos.children[0].querySelector('img');
      var cover = li.querySelector('.lp-cover img');
      li.querySelector('.lp-cover').classList.toggle('lp-cover-video', photos.children[0].dataset.kind === 'video');
      if (first && first.getAttribute('src') && cover.getAttribute('src') !== first.getAttribute('src')) cover.src = first.getAttribute('src');
      var count = li.querySelector('.lp-count');
      count.textContent = '+' + (n - 1);
      count.hidden = n < 2;
      li.querySelector('.lp-meta-town').textContent = r.town;
      li.querySelector('.lp-meta-when').textContent = ['Posted ' + ago(r.posted_at), r.taken_at ? 'taken ' + shortDate(r.taken_at) : ''].filter(Boolean).join(' · ');
      var c = li.querySelector('.lp-meta-comment');
      c.textContent = r.comment; c.hidden = !r.comment;
      li.dataset.hidden = r.hidden ? 'true' : 'false';
      li.querySelector('.lp-badge').hidden = !r.hidden;
      var hide = li.querySelector('.lp-hide');
      hide.textContent = r.hidden ? 'Unhide' : 'Hide';
      hide.setAttribute('aria-pressed', r.hidden ? 'true' : 'false');
      li.querySelector('.lp-edit').textContent = li.querySelector('.lp-editor').hidden ? 'Edit' : 'Close';
      li.querySelector('.lp-expand').textContent = wrap.hidden ? (n > 1 ? n + ' photos' : 'Photo') : 'Done';
    }

    function photoRow(p, post) {
      var li = el('li', 'lp-photo');
      li.dataset.id = p.id;
      li.dataset.kind = p.kind === 'video' ? 'video' : 'photo';
      var img = el('img');
      img.alt = ''; img.loading = 'lazy'; img.width = 48; img.height = 48;
      if (p.thumb) img.src = p.thumb;
      var rm = btn('lp-remove', 'Remove');
      var sure = btn('lp-remove-confirm', 'Tap to remove'); sure.hidden = true;
      rm.addEventListener('click', function () {
        rm.hidden = true; sure.hidden = false;
        setTimeout(function () { if (!sure.disabled) { sure.hidden = true; rm.hidden = false; } }, 4000);
      });
      sure.addEventListener('click', function () {
        sure.disabled = true; sure.textContent = 'Removing…';
        api('/api/live/delete', { token: token, id: p.id }).then(function () {
          addRemoved(p.id);
          li.remove();
          refreshRow(post);
        }, function () {
          if (dead) return;
          sure.disabled = false; sure.textContent = 'Couldn’t remove — try again';
        });
      });
      li.appendChild(img); li.appendChild(rm); li.appendChild(sure);
      return li;
    }

    // where 'top' puts a new post first (just posted), 'end' appends (list order).
    function addPhoto(p, where) {
      if (!p.id || hasPhoto(p.id)) return;
      var row = findRow(postKey(p));
      if (!row) {
        row = makeRow(p);
        if (where === 'top') els.recent.insertBefore(row, els.recent.firstChild);
        else els.recent.appendChild(row);
      }
      row.querySelector('.lp-photos').appendChild(photoRow(p, row));
      refreshRow(row);
      els.recentEmpty.hidden = true;
    }

    function addJustPosted(p) {
      var row = findRow(postKey(p));
      if (row && row !== els.recent.firstElementChild) els.recent.insertBefore(row, els.recent.firstChild);
      addPhoto(p, 'top');
    }

    // POST /api/live/list {token, cursor?, n} -> {posts: feed shape + hidden, next}.
    // Hidden posts included, newest first, never cached.
    var listBusy = false, nextCursor = null;
    function loadList(cursor) {
      if (listBusy || dead) return;
      listBusy = true;
      els.listError.hidden = true;
      els.more.hidden = true;
      els.listLoading.hidden = false;
      var body = { token: token };
      if (cursor) body.cursor = cursor;
      body.n = LIST_N;
      api('/api/live/list', body).then(function (d) {
        listBusy = false;
        els.listLoading.hidden = true;
        var gone = removedIds();
        // A just-deleted photo can linger in Cloudinary search for a moment.
        (d.posts || []).forEach(function (post) {
          var photos = Array.isArray(post.photos) ? post.photos : [post];
          photos.forEach(function (ph) {
            if (!ph || gone.indexOf(ph.id) !== -1) return;
            addPhoto({ id: ph.id, batch: post.id, kind: ph.kind, thumb: ph.thumb || ph.poster, town: post.town, taken_at: post.taken_at, posted_at: post.posted_at, comment: post.comment, hidden: post.hidden === true }, 'end');
          });
        });
        nextCursor = d.next || null;
        els.more.hidden = !nextCursor;
        els.recentEmpty.hidden = !!els.recent.children.length;
      }, function () {
        listBusy = false;
        els.listLoading.hidden = true;
        if (dead) return;
        els.listError.hidden = false;
        els.listRetry.onclick = function () { loadList(cursor); };
      });
    }
    els.more.addEventListener('click', function () { if (nextCursor) loadList(nextCursor); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
