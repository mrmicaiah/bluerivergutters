#!/usr/bin/env node
/**
 * mirror-project-images.mjs
 *
 * Mirrors Blue River Gutters' project photos off RealWork Labs and into our own
 * Cloudinary account, so the project gallery doesn't depend on a third party we
 * don't control.
 *
 * Reads src/_data/projects.json, walks every project's images[], downloads each
 * distinct RealWork source file at full size (no ?w=&h=&f= transform params) and
 * uploads it to Cloudinary under a descriptive public_id:
 *
 *   blueriver-projects/{citySlug}-{service-slug}-{slug last 6}-{index}
 *   e.g. blueriver-projects/madison-gutter-cleaning-Y9Oz2O-1
 *
 * Results are recorded in scripts/realwork-cloudinary-map.json, keyed by the
 * RealWork base URL (query stripped):
 *
 *   "https://app.realworklabs.com/media/abc123.jpg": "blueriver-projects/…-1"
 *   "https://app.realworklabs.com/media/dead99.jpg": null   // dead at source
 *
 * The map is the durable artifact: fetch-rwl-data.mjs reads it so a feed
 * re-sync keeps pointing at Cloudinary instead of reverting to RealWork.
 *
 * Idempotent and resumable — already-mapped URLs are skipped, and the map is
 * written after every upload, so an interrupted run picks up where it stopped.
 *
 * Usage:
 *   CLOUDINARY_URL=cloudinary://key:secret@cloud node scripts/mirror-project-images.mjs
 *   node scripts/mirror-project-images.mjs --dry-run    # download + verify only, no uploads
 *   node scripts/mirror-project-images.mjs --limit=5    # first N files (smoke test)
 *   node scripts/mirror-project-images.mjs --force      # re-upload even if already mapped
 *
 * CLOUDINARY_URL is read from the environment, falling back to a .env file at
 * the repo root. The secret is never logged.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECTS_PATH = path.join(REPO_ROOT, "src", "_data", "projects.json");
const MAP_PATH = path.join(__dirname, "realwork-cloudinary-map.json");
const FOLDER = "blueriver-projects";

// A RealWork /media/ URL whose S3 object is gone still answers 200/206 — with a
// ~350 byte <Error><Code>NoSuchKey</Code> body wearing application/octet-stream.
// Status codes can't see it; content-type and size can.
const MIN_IMAGE_BYTES = 5000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith("--limit="));
  return a ? Number(a.slice("--limit=".length)) : Infinity;
})();

// ---------------------------------------------------------------- credentials

async function loadCloudinaryConfig() {
  let url = process.env.CLOUDINARY_URL;

  if (!url) {
    try {
      const envFile = await fs.readFile(path.join(REPO_ROOT, ".env"), "utf8");
      const line = envFile
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("CLOUDINARY_URL="));
      if (line) url = line.slice("CLOUDINARY_URL=".length).trim().replace(/^["']|["']$/g, "");
    } catch {
      /* no .env — fall through to the error below */
    }
  }

  if (!url) {
    fail(
      "Missing CLOUDINARY_URL.\n" +
        "  Set it in the environment or in a .env file at the repo root:\n" +
        "    CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@dxzw1zwez\n" +
        "  See .env.example. (--dry-run needs no credentials.)"
    );
  }

  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m) {
    fail(
      "CLOUDINARY_URL is malformed. Expected cloudinary://<api_key>:<api_secret>@<cloud_name>."
    );
  }
  const [, apiKey, apiSecret, cloudName] = m;

  // Cloudinary issues numeric API keys. A non-numeric one is almost always a
  // placeholder left in the file — say so plainly rather than fail 148 times.
  if (!/^\d+$/.test(apiKey)) {
    console.warn(
      `⚠️  api_key is not numeric (${apiKey.length} chars) — Cloudinary keys are numeric.\n` +
        "   This is usually a placeholder. Expect auth to fail."
    );
  }
  return { apiKey, apiSecret, cloudName };
}

async function verifyAuth({ apiKey, apiSecret, cloudName }) {
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/ping`, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64"),
    },
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    fail(
      `Cloudinary auth failed: HTTP ${res.status} ${redact(body, apiSecret)}\n` +
        `  cloud_name=${cloudName}, api_key=<${apiKey.length} chars>\n` +
        "  Check CLOUDINARY_URL. Nothing was uploaded."
    );
  }
  console.log(`✅ Cloudinary auth OK (cloud: ${cloudName})`);
}

// ------------------------------------------------------------------- helpers

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function redact(text, secret) {
  return secret ? String(text).split(secret).join("<secret>") : String(text);
}

function serviceSlug(service) {
  return String(service).toLowerCase().trim().replace(/\s+/g, "-");
}

/** blueriver-projects/{city}-{service}-{slug tail}-{index} — validated collision-free. */
function publicIdFor(project, index) {
  const tail = project.slug.slice(-6);
  return `${FOLDER}/${project.citySlug}-${serviceSlug(project.service)}-${tail}-${index}`;
}

function baseUrl(u) {
  return String(u).split("?")[0];
}

/** Every distinct RealWork source file, with the public_id it should become. */
function planFrom(projects) {
  const plan = [];
  const seen = new Set();
  for (const project of projects) {
    const images = project.images || [];
    images.forEach((url, i) => {
      if (!url.includes("app.realworklabs.com")) return;
      const src = baseUrl(url);
      if (seen.has(src)) return; // no source file is shared between projects today
      seen.add(src);
      plan.push({ src, publicId: publicIdFor(project, i + 1), slug: project.slug });
    });
  }
  return plan;
}

async function loadMap() {
  try {
    return JSON.parse(await fs.readFile(MAP_PATH, "utf8"));
  } catch {
    return {
      _comment:
        "RealWork Labs source URL -> Cloudinary public_id. Written by scripts/mirror-project-images.mjs, " +
        "read by scripts/fetch-rwl-data.mjs so a feed re-sync keeps pointing at our own Cloudinary assets. " +
        "Keys are RealWork /media/ URLs with the query string stripped.",
      _comment_null_values:
        "A null value means the source object is dead at RealWork: the URL still answers 200/206 but returns " +
        "a ~350 byte S3 <Error><Code>NoSuchKey</Code> body as application/octet-stream, not an image. " +
        "These photos cannot be mirrored and are dropped from projects.json output entirely.",
      mappings: {},
    };
  }
}

async function saveMap(map) {
  await fs.writeFile(MAP_PATH, JSON.stringify(map, null, 2) + "\n", "utf8");
}

/** Download at full size and reject anything that isn't really an image. */
async function download(src) {
  const res = await fetch(src, { headers: { Accept: "image/*" } });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!contentType.startsWith("image/")) {
    return {
      ok: false,
      reason: `content-type ${contentType || "(none)"} (${buffer.length} bytes) — dead at source`,
      dead: true,
    };
  }
  if (buffer.length < MIN_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `only ${buffer.length} bytes — not a real image`,
      dead: true,
    };
  }
  return { ok: true, buffer, contentType };
}

async function upload({ apiKey, apiSecret, cloudName }, publicId, buffer, contentType) {
  const timestamp = Math.floor(Date.now() / 1000);
  // Signature: sorted params as k=v&k=v, then the api_secret appended, sha1'd.
  const params = { overwrite: "false", public_id: publicId, timestamp: String(timestamp) };
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const signature = crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), path.basename(publicId));
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("public_id", publicId);
  form.append("overwrite", "false");
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${redact(json?.error?.message || "", apiSecret) || "upload failed"}`
    );
  }
  return json;
}

// ---------------------------------------------------------------------- main

async function main() {
  const projects = JSON.parse(await fs.readFile(PROJECTS_PATH, "utf8"));
  const plan = planFrom(projects);
  const map = await loadMap();
  map.mappings = map.mappings || {};

  const todo = plan.filter((p) => FORCE || !(p.src in map.mappings)).slice(0, LIMIT);

  console.log(`Projects: ${projects.length}`);
  console.log(`Distinct RealWork source files: ${plan.length}`);
  console.log(`Already mapped: ${plan.length - plan.filter((p) => !(p.src in map.mappings)).length}`);
  console.log(`To process this run: ${todo.length}${DRY_RUN ? "  (DRY RUN — no uploads)" : ""}\n`);

  if (!todo.length) {
    console.log("Nothing to do.");
    return;
  }

  let config = null;
  if (!DRY_RUN) {
    config = await loadCloudinaryConfig();
    await verifyAuth(config);
  }

  let uploaded = 0;
  let dead = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];

  for (const [i, item] of todo.entries()) {
    const n = `[${i + 1}/${todo.length}]`;
    const dl = await download(item.src);

    if (!dl.ok) {
      if (dl.dead) {
        dead++;
        if (!DRY_RUN) {
          map.mappings[item.src] = null;
          await saveMap(map);
        }
        console.log(`${n} ☠️  ${item.publicId} — ${dl.reason}`);
      } else {
        failed++;
        failures.push({ src: item.src, reason: dl.reason });
        console.log(`${n} ❌ ${item.publicId} — download failed: ${dl.reason}`);
      }
      continue;
    }

    bytes += dl.buffer.length;

    if (DRY_RUN) {
      uploaded++;
      console.log(
        `${n} ✓ ${item.publicId} — ${(dl.buffer.length / 1024).toFixed(0)} KB ${dl.contentType}`
      );
      continue;
    }

    try {
      const result = await upload(config, item.publicId, dl.buffer, dl.contentType);
      map.mappings[item.src] = result.public_id || item.publicId;
      await saveMap(map); // resumable: persist after every success
      uploaded++;
      console.log(
        `${n} ⬆️  ${item.publicId} — ${(dl.buffer.length / 1024).toFixed(0)} KB`
      );
    } catch (err) {
      failed++;
      failures.push({ src: item.src, reason: err.message });
      console.log(`${n} ❌ ${item.publicId} — ${err.message}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${DRY_RUN ? "Verified" : "Uploaded"}: ${uploaded}`);
  console.log(`Dead at source (mapped null): ${dead}`);
  console.log(`Failed: ${failed}`);
  console.log(`Bytes ${DRY_RUN ? "downloaded" : "transferred"}: ${(bytes / 1048576).toFixed(1)} MB`);
  if (!DRY_RUN) console.log(`Map: ${path.relative(REPO_ROOT, MAP_PATH)}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.src}\n    ${f.reason}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
