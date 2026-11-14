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
 * gps. No timestamp is sent: the server picks one (so a phone clock that's
 * off can't get a photo refused) and the upload uses the RETURNED timestamp,
 * which the signature covers. Post stays disabled until a town is set. A failure on one photo doesn't stop the
 * rest; Post then retries only the failed ones. A 403 anywhere means the link
 * is dead: show the "link not valid" screen.
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
  var MAX_TOWN_KM = 25;
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
  function contextString(obj) {
    return Object.keys(obj).filter(function (k) { return obj[k] !== undefined && obj[k] !== ''; })
      .map(function (k) { return k + '=' + escapeCtx(obj[k]); }).join('|');
  }

  window.BRGLivePost = {
    readExif: readExif, nearestTown: nearestTown, towns: towns,
    hasCentroid: function (t) { return !!CENTROIDS[t]; }, contextString: contextString
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
      again: $('lp-again'), recent: $('lp-recent'), recentEmpty: $('lp-recent-empty')
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

    function baseParams() {
      return { folder: FOLDER, tags: TAG, transformation: TRANSFORMATION };
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

    els.files.addEventListener('change', function () {
      var files = Array.prototype.slice.call(els.files.files || []);
      if (!files.length) return;
      resetBatch();
      els.success.hidden = true;
      els.compose.hidden = false;
      files.forEach(function (file) {
        var item = { file: file, exif: {}, state: 'ready' };
        item.el = renderItem(item);
        batch.push(item);
      });
      Promise.all(batch.map(function (item) {
        return exifFromFile(item.file).then(function (exif) {
          item.exif = exif;
          if (exif.taken_at) item.el.dataset.takenAt = exif.taken_at;
          if (exif.gps) item.el.dataset.gps = exif.gps;
          var when = item.el.querySelector('.lp-item-when');
          when.textContent = exif.taken_at ? 'Taken ' + shortDate(exif.taken_at) : 'No photo date';
        });
      })).then(chooseTown);
      updatePostButton();
    });

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
      li.dataset.state = 'ready';
      var img = document.createElement('img');
      img.alt = '';
      try { img.src = URL.createObjectURL(item.file); } catch (e) {}
      img.onerror = function () { img.style.visibility = 'hidden'; };
      var meta = document.createElement('div'); meta.className = 'lp-item-meta';
      var when = document.createElement('span'); when.className = 'lp-item-when'; when.textContent = 'Reading…';
      var status = document.createElement('span'); status.className = 'lp-item-status'; status.textContent = 'Ready';
      var bar = document.createElement('progress'); bar.className = 'lp-progress'; bar.max = 100; bar.value = 0;
      meta.appendChild(when); meta.appendChild(status); meta.appendChild(bar);
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
      batch.forEach(function (item) { var img = item.el.querySelector('img'); try { URL.revokeObjectURL(img.src); } catch (e) {} });
      batch = [];
      els.items.textContent = '';
      clearError();
    }

    function pending() { return batch.filter(function (i) { return i.state !== 'done'; }); }

    function updatePostButton() {
      var failed = batch.filter(function (i) { return i.state === 'failed'; }).length;
      var left = pending().length;
      els.post.disabled = !left || posting || !els.town.value;
      if (failed) els.post.textContent = 'Retry ' + failed + ' failed';
      else els.post.textContent = left > 1 ? 'Post ' + left + ' photos' : 'Post';
    }

    function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
    function clearError() { els.error.textContent = ''; els.error.hidden = true; }

    // ---- posting -----------------------------------------------------------
    var posting = false;

    els.post.addEventListener('click', function () {
      if (posting || dead) return;
      clearError();
      var todo = pending();
      if (!todo.length) return;
      var town = els.town.value;
      if (!town) { showError('Pick the town first.'); els.town.focus(); return; }
      lsSet(LS_TOWN, town);
      var comment = els.comment.value.trim();
      posting = true;
      els.compose.classList.add('lp-busy');
      updatePostButton();

      todo.reduce(function (chain, item) {
        return chain.then(function () { if (!dead) return postOne(item, town, comment); });
      }, Promise.resolve()).then(function () {
        posting = false;
        els.compose.classList.remove('lp-busy');
        if (dead) return;
        updatePostButton();
        var failed = batch.filter(function (i) { return i.state === 'failed'; }).length;
        if (failed) { showError(failed + (failed > 1 ? ' photos' : ' photo') + ' didn’t go up. Check signal and tap Retry.'); return; }
        var n = batch.length;
        els.successText.textContent = 'Posted ' + n + (n > 1 ? ' photos' : ' photo') + ' to ' + town + '.';
        els.success.hidden = false;
        els.compose.hidden = true;
        els.comment.value = '';
        els.files.value = '';
      });
    });

    function postOne(item, town, comment) {
      var ctx = { town: town };
      if (item.exif.taken_at) ctx.taken_at = item.exif.taken_at;
      if (comment) ctx.comment = comment;
      if (item.exif.gps) ctx.gps = item.exif.gps;
      var params = baseParams();
      params.context = contextString(ctx);
      setState(item, 'signing', 'Starting…', 0);
      return api('/api/live/sign', { token: token, params_to_sign: params }).then(function (sig) {
        // The signature covers the server's timestamp: upload with exactly that.
        if (!sig.timestamp || !sig.signature) throw new Error('bad sign response');
        params.timestamp = sig.timestamp;
        return upload(item, params, sig);
      }).then(function (res) {
        setState(item, 'done', 'Posted', 100);
        prependRecent({ id: res.public_id, thumb: thumbUrl(res.secure_url), town: town, taken_at: item.exif.taken_at || null, posted_at: new Date().toISOString(), comment: comment || null });
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
        xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + (sig.cloud_name || CLOUD) + '/image/upload');
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
      resetBatch();
      els.success.hidden = true;
      els.compose.hidden = true;
      updatePostButton();
      els.files.click();
    });

    // ---- recent posts -----------------------------------------------------
    function thumbUrl(u) { return String(u || '').replace('/image/upload/', '/image/upload/w_300,h_300,c_fill,f_auto,q_auto/'); }

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

    function recentRow(p) {
      var li = document.createElement('li');
      li.className = 'lp-recent-item';
      li.dataset.id = p.id;
      var img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.width = 64; img.height = 64;
      if (p.thumb) img.src = p.thumb;
      var meta = document.createElement('div'); meta.className = 'lp-recent-meta';
      var line = document.createElement('strong');
      line.textContent = [p.taken_at ? 'Taken ' + shortDate(p.taken_at) : '', p.town, 'Posted ' + ago(p.posted_at)].filter(Boolean).join(' · ');
      meta.appendChild(line);
      if (p.comment) { var c = document.createElement('span'); c.textContent = p.comment; meta.appendChild(c); }
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'lp-remove'; rm.textContent = 'Remove';
      var sure = document.createElement('button'); sure.type = 'button'; sure.className = 'lp-remove-confirm'; sure.textContent = 'Tap to remove'; sure.hidden = true;
      rm.addEventListener('click', function () {
        rm.hidden = true; sure.hidden = false;
        setTimeout(function () { if (!sure.disabled) { sure.hidden = true; rm.hidden = false; } }, 4000);
      });
      sure.addEventListener('click', function () {
        sure.disabled = true; sure.textContent = 'Removing…';
        api('/api/live/delete', { token: token, id: p.id }).then(function () {
          addRemoved(p.id);
          li.remove();
          if (!els.recent.children.length) els.recentEmpty.hidden = false;
        }, function () {
          if (dead) return;
          sure.disabled = false; sure.textContent = 'Couldn’t remove — try again';
        });
      });
      li.appendChild(img); li.appendChild(meta); li.appendChild(rm); li.appendChild(sure);
      return li;
    }

    function prependRecent(p) {
      if (!p.id) return;
      var existing = els.recent.querySelector('[data-id="' + CSS.escape(p.id) + '"]');
      if (existing) existing.remove();
      els.recent.insertBefore(recentRow(p), els.recent.firstChild);
      els.recentEmpty.hidden = true;
    }

    function loadRecent() {
      fetch('/api/live/feed?n=12').then(function (r) { return r.ok ? r.json() : { posts: [] }; }).then(function (d) {
        var hide = removedIds();
        (d.posts || []).forEach(function (p) {
          if (hide.indexOf(p.id) !== -1 || els.recent.querySelector('[data-id="' + CSS.escape(p.id) + '"]')) return;
          els.recent.appendChild(recentRow(p));
        });
        els.recentEmpty.hidden = !!els.recent.children.length;
      }).catch(function () { els.recentEmpty.hidden = !!els.recent.children.length; });
    }
    loadRecent();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
