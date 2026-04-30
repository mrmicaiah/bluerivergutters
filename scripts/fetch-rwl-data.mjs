#!/usr/bin/env node
/**
 * fetch-rwl-data.mjs
 *
 * Pulls Blue River Gutters' job feed from RealWorkLabs and writes it to
 * src/_data/projects.json so Eleventy can render the gallery + individual
 * project pages server-side (SEO-friendly, no JS dependency).
 *
 * Usage:
 *   node scripts/fetch-rwl-data.mjs            # fetches live RWL endpoint
 *   node scripts/fetch-rwl-data.mjs --from=path/to/sample.json  # uses local file
 *
 * Run from repo root. Overwrites src/_data/projects.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "src", "_data", "projects.json");

const RWL_KEY = "RlomFVKLymXtpSXg";
const RWL_URL =
  `https://app.realworklabs.com/plugin/data?key=${RWL_KEY}` +
  `&contentType=Default&limit=200&contentFilters=${encodeURIComponent(
    JSON.stringify({ labels: [] })
  )}`;

// A real Blue River Gutters job photo, used as the fallback when a project
// has only a review with no images. Looks better than a "no image" gray box.
const FALLBACK_THUMBNAIL =
  "https://res.cloudinary.com/dxzw1zwez/image/upload/q_auto,f_auto,w_800,h_600,c_fill/v1769832696/gutter_being_prepared_bvglmy.webp";
const FALLBACK_FULL =
  "https://res.cloudinary.com/dxzw1zwez/image/upload/q_auto,f_auto,w_1600/v1769832696/gutter_being_prepared_bvglmy.webp";

// City normalization — RWL returns these inconsistently. Keys are lowercased
// versions of what we see in the wild; values are the proper display form.
const CITY_MAP = {
  "owenscrossroads": "Owens Cross Roads",
  "owens cross roads": "Owens Cross Roads",
  "owens crossroads": "Owens Cross Roads",
  "hamptoncove": "Hampton Cove",
  "hampton cove": "Hampton Cove",
  "newhope": "New Hope",
  "new hope": "New Hope",
  "newmarket": "New Market",
  "new market": "New Market",
  "hazelgreen": "Hazel Green",
  "hazel green": "Hazel Green",
  "laceysspring": "Laceys Spring",
  "laceys spring": "Laceys Spring",
  "lacey's spring": "Laceys Spring",
  "paintrock": "Paint Rock",
  "paint rock": "Paint Rock",
  "huntsville": "Huntsville",
  "madison": "Madison",
  "decatur": "Decatur",
  "athens": "Athens",
  "hartselle": "Hartselle",
  "elkmont": "Elkmont",
  "brownsboro": "Brownsboro",
  "meridianville": "Meridianville",
  "harvest": "Harvest",
  "toney": "Toney",
  "monrovia": "Monrovia",
  "priceville": "Priceville",
  "trinity": "Trinity",
  "tanner": "Tanner",
  "somerville": "Somerville",
  "ardmore": "Ardmore",
  "gurley": "Gurley",
  "triana": "Triana",
  "albertville": "Albertville",
  "arab": "Arab",
  "cullman": "Cullman",
  "guntersville": "Guntersville",
  "scottsboro": "Scottsboro",
  "falkville": "Falkville",
};

// City pages that exist on the site. Cities NOT in this set will link to
// /recent-projects/ instead of producing a 404.
// (Source: src/locations/ directory — keep this in sync if pages are added.)
const CITY_PAGES = new Set([
  "huntsville",
  "madison",
  "decatur",
  "athens",
  "hartselle",
  "hampton-cove",
  "owens-cross-roads",
  "meridianville",
  "hazel-green",
  "harvest",
  "toney",
  "monrovia",
  "new-hope",
  "new-market",
  "brownsboro",
  "priceville",
  "trinity",
  "tanner",
  "somerville",
  "laceys-spring",
  "elkmont",
  "ardmore",
  "gurley",
  "paint-rock",
  "triana",
  "albertville",
  "arab",
  "cullman",
  "guntersville",
  "scottsboro",
]);

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCity(rawCity) {
  if (!rawCity) return null;
  const key = rawCity.trim().toLowerCase();
  if (CITY_MAP[key]) return CITY_MAP[key];
  // Fallback: title-case the raw value if not in our map. Worth logging.
  return rawCity
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function detectService(description) {
  const text = String(description || "").toLowerCase();

  // Order matters — most specific first. A description mentioning both
  // "drain" and "gutter" is most likely a drain job.
  if (/(french drain|dry well|underground|drain pit|catch basin)/.test(text)) {
    return "Underground Drains";
  }
  if (/(rotten|wood rot|fascia.*replac|replac.*fascia|rafter tail|sub-fascia|sub fascia|pvc.*fascia)/.test(text)) {
    return "Rotten Wood Repair";
  }
  if (/(leaf guard|gutter guard|gutter topper|leaf dog|micro-mesh|micro mesh|perforated aluminum|leaf toppers)/.test(text)) {
    return "Gutter Guards";
  }
  if (/(gutter cleaning|cleaned the gutter|cleaning out|unclog|clear debris|debris from)/.test(text)) {
    return "Gutter Cleaning";
  }
  if (/(downspout|spout)/.test(text) && !/k.style|k style|seamless/.test(text)) {
    return "Downspouts";
  }
  if (/(seamless|k.style|k style|6.inch|5.inch|hidden hanger|installed.*gutter|new gutter|gutter system|gutter installation|installed a.*gutter|replac.*gutter)/.test(text)) {
    return "Seamless Gutters";
  }
  if (/(repair|sealed.*joint|re.pitch|re.secur|re-secur|leaking joint)/.test(text)) {
    return "Seamless Gutters"; // gutter repairs roll up to seamless
  }
  if (/(custom.*metal|metal forming|aluminum cladding|fascia capping)/.test(text)) {
    return "Rotten Wood Repair";
  }
  return "Gutter Services";
}

function generateTitle(service, city) {
  if (!city) return `${service} Project`;
  return `${service} in ${city}, AL`;
}

function buildSizedUrl(sourceUrl, w, h) {
  // RWL serves transformed images at /media/{hash}.jpg?w=W&h=H&f=webp.
  // The /ugc/ path serves originals (often 3-5MB) — too heavy for browsers.
  if (!sourceUrl) return null;
  const mediaUrl = sourceUrl.replace("/ugc/", "/media/");
  const base = mediaUrl.split("?")[0];
  return `${base}?w=${w}&h=${h}&f=webp`;
}

function buildThumbnail(sourceUrl) {
  return buildSizedUrl(sourceUrl, 800, 600);
}

function buildHero(sourceUrl) {
  return buildSizedUrl(sourceUrl, 1600, 900);
}

function buildFull(sourceUrl) {
  // For lightbox / detail-page gallery: 1200px wide is plenty.
  return buildSizedUrl(sourceUrl, 1200, 900);
}

function transform(workSites) {
  const seenSlugs = new Set();
  const unknownCities = new Set();

  const projects = workSites
    .map((entry) => {
      // Extract photos and reviews from content[]
      const photos = [];
      let review = null;

      for (const item of entry.content || []) {
        if (item.type === "Checkin" && item.media && item.media.length > 0) {
          for (const m of item.media) {
            if (m.type === "photo" && m.sourceUrl) {
              photos.push({
                full: buildFull(m.sourceUrl) || m.sourceUrl,
                thumb: buildThumbnail(m.sourceUrl) || m.sourceUrl,
                hero: buildHero(m.sourceUrl) || m.sourceUrl,
                isCover: !!m.isCover,
              });
            }
          }
        } else if (item.type === "Review" && item.message && item.message.trim()) {
          // Take the first review with a real message; ignore rating-only entries
          if (!review) {
            review = {
              rating: item.rating || 5,
              author: item.author || "Customer",
              text: item.message.trim(),
              source: item.source === "GMB" ? "Google" : (item.source || "Google"),
            };
          }
        }
      }

      const hasPhotos = photos.length > 0;
      const hasReview = !!review;

      // Filter: project must have at least 1 photo or a review with text
      if (!hasPhotos && !hasReview) return null;

      // Location handling
      const li = entry.locationInfo || {};
      const stateRaw = (li.state || "").trim();
      const state = stateRaw.toUpperCase();

      // Filter: Alabama only
      if (state && state !== "AL") {
        return null;
      }

      // Some entries omit `city` but include `neighborhood` — use it as fallback.
      // Real example from the data: Laceys Spring is recorded as a neighborhood.
      const city = normalizeCity(li.city || li.neighborhood);
      const zip = li.zip || null;

      if (!city) {
        // No city — we'll skip these. Hard to title or link them sensibly.
        return null;
      }

      // Track cities not in our known set so we can update CITY_PAGES later
      const citySlug = slugify(city);
      if (!CITY_PAGES.has(citySlug)) {
        unknownCities.add(city);
      }

      const description = (entry.description || "").trim();
      const service = detectService(description);
      const title = generateTitle(service, city);

      // Date: ms → ISO date
      const dateMs = entry.dateInMillis || entry.sortDateInMillis || Date.now();
      const date = new Date(dateMs).toISOString().slice(0, 10);

      // Slug: city-service-id (id is RWL's stable ID)
      const baseSlug = `${slugify(city)}-${slugify(service)}-${entry.id}`;
      let slug = baseSlug;
      let n = 2;
      while (seenSlugs.has(slug)) {
        slug = `${baseSlug}-${n++}`;
      }
      seenSlugs.add(slug);

      // Sort photos: cover first, then by original order
      photos.sort((a, b) => {
        if (a.isCover && !b.isCover) return -1;
        if (!a.isCover && b.isCover) return 1;
        return 0;
      });

      const thumbnail = hasPhotos
        ? photos[0].thumb || photos[0].full
        : FALLBACK_THUMBNAIL;
      const heroImage = hasPhotos
        ? photos[0].hero || photos[0].full
        : FALLBACK_FULL;
      const images = hasPhotos ? photos.map((p) => p.full) : [FALLBACK_FULL];

      return {
        id: entry.id,
        slug,
        title,
        city,
        citySlug,
        cityHasPage: CITY_PAGES.has(citySlug),
        state: "AL",
        zip,
        geolocation: entry.geolocation || null,
        date,
        service,
        description,
        thumbnail,
        heroImage,
        images,
        review,
        hasPhotos,
        hasReview,
      };
    })
    .filter(Boolean);

  // Sort by date descending (newest first)
  projects.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { projects, unknownCities: [...unknownCities] };
}

async function fetchRWL() {
  console.log(`Fetching: ${RWL_URL}`);
  const res = await fetch(RWL_URL, {
    headers: {
      Origin: "https://bluerivergutters.com",
      Referer: "https://bluerivergutters.com/",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`RWL endpoint returned ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadFromFile(filePath) {
  console.log(`Reading: ${filePath}`);
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function main() {
  // Allow loading from a local file for testing: --from=path/to/file.json
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const fromPath = fromArg ? fromArg.slice("--from=".length) : null;

  let raw;
  try {
    raw = fromPath ? await loadFromFile(fromPath) : await fetchRWL();
  } catch (err) {
    console.error("Failed to load RWL data:", err.message);
    process.exit(1);
  }

  const workSites = raw.workSites || [];
  console.log(`Loaded ${workSites.length} raw entries from RWL`);

  const { projects, unknownCities } = transform(workSites);

  console.log(`Transformed → ${projects.length} valid projects`);
  console.log(
    `  with photos: ${projects.filter((p) => p.hasPhotos).length}` +
      `, with review: ${projects.filter((p) => p.hasReview).length}` +
      `, both: ${projects.filter((p) => p.hasPhotos && p.hasReview).length}`
  );

  // Service breakdown
  const serviceCounts = {};
  for (const p of projects) {
    serviceCounts[p.service] = (serviceCounts[p.service] || 0) + 1;
  }
  console.log("\nServices:");
  for (const [s, c] of Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }

  // City breakdown
  const cityCounts = {};
  for (const p of projects) {
    cityCounts[p.city] = (cityCounts[p.city] || 0) + 1;
  }
  console.log("\nCities (top 15):");
  for (const [c, count] of Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    console.log(`  ${c}: ${count}`);
  }

  if (unknownCities.length) {
    console.log("\n⚠️  Cities without dedicated city page (linked to /recent-projects/):");
    for (const c of unknownCities) console.log(`  - ${c}`);
  }

  // Write output
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(projects, null, 2) + "\n", "utf8");
  console.log(`\n✅ Wrote ${projects.length} projects to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
