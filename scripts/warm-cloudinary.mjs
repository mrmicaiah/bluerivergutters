#!/usr/bin/env node
/**
 * Warm Cloudinary's derived-image cache after a deploy.
 *
 * A Cloudinary transformation URL that has never been requested is generated
 * on first hit — ~2 s for the large hero sources (measured 2026-09-23), vs
 * ~0.1 s once derived. New hero variants (mobileBg crops) and cldAuto service
 * images would otherwise make the first real phone visitor to each page pay
 * that, right on the LCP image.
 *
 * Reads the BUILT site (_site/) as the source of truth, collects the URLs,
 * and requests each one twice with a Chrome Accept header (the first request
 * derives + caches; the second confirms it now comes back warm). Only
 * res.cloudinary.com is contacted — never the website itself.
 *
 * Derivation is global (once per URL + format); the Fastly edge cache is
 * per-POP, so this warms the POP nearest to wherever it runs plus the origin.
 *
 * Post-deploy convention: always run with --all (~350 URLs, a couple of
 * minutes). The default set is heroes + cldAuto images only and skips new
 * content images; --all can't miss anything.
 *
 * Usage (run `npm run build` first so _site/ matches what was deployed):
 *   node scripts/warm-cloudinary.mjs --dry-run      list URLs, no requests
 *   node scripts/warm-cloudinary.mjs                heroes + cldAuto images
 *   node scripts/warm-cloudinary.mjs --all          every Cloudinary URL in _site
 *   node scripts/warm-cloudinary.mjs --all-formats  also warm webp-only / jpeg variants
 *                                                   (f_auto negotiates per Accept header)
 *   node scripts/warm-cloudinary.mjs --urls-file f  warm URLs from a file (one per line)
 *
 * Options: --concurrency N (default 6), --site DIR (default _site)
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const SITE = opt("--site", "_site");
const CONCURRENCY = Number(opt("--concurrency", 6));
const CLD = /https:\/\/res\.cloudinary\.com\/dxzw1zwez\/image\/upload\/[^\s"'()<>]+/g;

const ACCEPTS = {
  chrome: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  webp: "image/webp,image/*,*/*;q=0.8",
  jpeg: "image/*,*/*;q=0.8",
};
const UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.name.endsWith(".html") || entry.name.endsWith(".css")) out.push(p);
  }
  return out;
}

// Which URLs this deploy introduced and that sit on a critical path:
//   - hero preloads (both media variants)
//   - .rsp-bg --bg-lg / --bg-sm custom properties
//   - homepage .hero-v2 backgrounds (inline <style>)
//   - cldAuto service images (f_auto,q_auto/<id> — no width)
function isTargeted(url, context) {
  if (/rel="preload" as="image"/.test(context)) return true;
  if (/--bg-(lg|sm):/.test(context)) return true;
  if (/w_1920\/|w_828\//.test(url)) return true;
  if (/\/upload\/f_auto,q_auto\/[^/]+$/.test(url)) return true;
  return false;
}

async function collect() {
  if (opt("--urls-file", null)) {
    const text = await readFile(opt("--urls-file"), "utf8");
    return [...new Set(text.split("\n").map((s) => s.trim()).filter(Boolean))];
  }
  const urls = new Set();
  for (const file of await walk(SITE)) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(CLD)) {
      const url = m[0].replace(/&amp;/g, "&");
      const context = text.slice(Math.max(0, m.index - 80), m.index);
      if (flag("--all") || isTargeted(url, context)) urls.add(url);
    }
  }
  return [...urls].sort();
}

function cacheState(res) {
  const st = res.headers.get("server-timing") || "";
  const m = st.match(/cld-[a-z]+;[^,]*desc=(hit|miss)/i);
  return m ? m[1].toLowerCase() : "?";
}

async function hit(url, accept) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { Accept: accept, "User-Agent": UA } });
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      ms: Math.round(performance.now() - t0),
      bytes: body.byteLength,
      type: (res.headers.get("content-type") || "").replace("image/", ""),
      cache: cacheState(res),
    };
  } catch (err) {
    return { status: "ERR", ms: Math.round(performance.now() - t0), bytes: 0, type: "", cache: "", error: err.message };
  }
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

const short = (u) => u.replace(/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//, "");

const urls = await collect();
const formats = flag("--all-formats") ? Object.keys(ACCEPTS) : ["chrome"];

if (flag("--dry-run")) {
  urls.forEach((u) => console.log(u));
  console.log(`\n${urls.length} URLs × ${formats.length} format(s) — dry run, no requests made.`);
  process.exit(0);
}

console.log(`Warming ${urls.length} URLs × ${formats.join("/")} (concurrency ${CONCURRENCY})…\n`);

const jobs = urls.flatMap((url) => formats.map((fmt) => ({ url, fmt })));
const rows = await pool(jobs, CONCURRENCY, async ({ url, fmt }) => {
  const first = await hit(url, ACCEPTS[fmt]);
  const second = first.status === 200 ? await hit(url, ACCEPTS[fmt]) : null;
  return { url, fmt, first, second };
});

let failed = 0;
for (const r of rows) {
  const ok = r.first.status === 200;
  if (!ok) failed++;
  const warm = r.second ? `${String(r.second.ms).padStart(5)}ms ${r.second.cache.padEnd(4)}` : "     -     ";
  console.log(
    `${ok ? "OK " : "FAIL"} ${String(r.first.status).padEnd(3)} ${r.fmt.padEnd(6)} ` +
      `cold ${String(r.first.ms).padStart(5)}ms ${r.first.cache.padEnd(4)} → warm ${warm} ` +
      `${String(Math.round(r.first.bytes / 1024)).padStart(5)}KB ${r.first.type.padEnd(5)} ${short(r.url)}` +
      (r.first.error ? `  (${r.first.error})` : "")
  );
}

const ok = rows.filter((r) => r.first.status === 200);
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const statusCounts = rows.reduce((acc, r) => ((acc[r.first.status] = (acc[r.first.status] || 0) + 1), acc), {});
const misses = ok.filter((r) => r.first.cache === "miss").length;
const slow = ok.filter((r) => r.first.ms > 1000).sort((a, b) => b.first.ms - a.first.ms);

console.log("\n── Summary ──────────────────────────────");
console.log(`Requests:        ${rows.length}  status ${JSON.stringify(statusCounts)}`);
console.log(`First request:   median ${med(ok.map((r) => r.first.ms))}ms, max ${Math.max(0, ...ok.map((r) => r.first.ms))}ms, CDN miss ${misses}/${ok.length}`);
console.log(`Second request:  median ${med(ok.filter((r) => r.second).map((r) => r.second.ms))}ms, CDN hit ${ok.filter((r) => r.second?.cache === "hit").length}/${ok.length}`);
if (slow.length) {
  console.log(`Cold >1s (were derived just now): ${slow.length}`);
  slow.slice(0, 10).forEach((r) => console.log(`  ${r.first.ms}ms  ${short(r.url)}`));
}
if (failed) {
  console.log(`\n${failed} request(s) failed — check the public IDs above.`);
  process.exit(1);
}
