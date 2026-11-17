// Shared by the Blue River Live endpoints (functions/api/live/*). Exports no
// onRequest handler, so Pages never turns this file into a route.
//
// Cloudinary layout for a Live post: images AND videos (WO-0150), folder
// "live/", tag "brg-live", context
// keys town, taken_at (ISO8601, optional), comment (optional) and gps
// ("lat,lng"). gps is PRIVATE: it lives only in Cloudinary context and no
// response from these endpoints may ever carry it.

export const CLOUD_NAME = 'dxzw1zwez';
export const LIVE_TAG = 'brg-live';
export const API_BASE = 'https://api.cloudinary.com/v1_1/' + CLOUD_NAME;
export const DELIVERY_BASE = 'https://res.cloudinary.com/' + CLOUD_NAME + '/image/upload/';
export const VIDEO_DELIVERY_BASE = 'https://res.cloudinary.com/' + CLOUD_NAME + '/video/upload/';
export const RESOURCE_TYPES = ['image', 'video'];
// Every Search for Live assets uses this, so images and videos page together.
export const LIVE_EXPRESSION = '(resource_type:image OR resource_type:video) AND tags=' + LIVE_TAG;
export const BAD_TOKEN_DELAY_MS = 1000;

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

// Loud 500 naming exactly what's missing, same as /api/lead.
export function missingEnv(env, names, what) {
  const missing = names.filter((k) => !env[k]);
  if (!missing.length) return null;
  console.error('LIVE ' + what + ' FAILED — missing env vars: ' + missing.join(', '));
  return json({ error: 'Server misconfigured: missing ' + missing.join(', ') }, 500);
}

async function sha(algo, text) {
  return new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(text)));
}

// Constant-time: both sides are hashed to 32 bytes first, so neither the
// comparison time nor the length of the given token tells anything.
export async function tokenOk(given, expected) {
  if (typeof given !== 'string' || !given || !expected) return false;
  const [a, b] = await Promise.all([sha('SHA-256', given), sha('SHA-256', expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Every bad-token outcome (wrong, empty, absent, unreadable body) gets this
// same response after the same pause, so nothing reveals why.
export async function forbidden() {
  await new Promise((resolve) => setTimeout(resolve, BAD_TOKEN_DELAY_MS));
  return json({ error: 'Forbidden' }, 403);
}

// Reads {token, ...} from a JSON body; null on anything unreadable.
export async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// Cloudinary's signing rule: every param except file, cloud_name,
// resource_type and api_key, empty values dropped, sorted by key, joined as
// key=value&..., secret appended, SHA-1 hex.
export async function cloudinarySignature(params, secret) {
  const skip = new Set(['file', 'cloud_name', 'resource_type', 'api_key']);
  const toSign = Object.keys(params)
    .filter((k) => !skip.has(k) && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
  const bytes = await sha('SHA-1', toSign + secret);
  return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function basicAuth(env) {
  return 'Basic ' + btoa(env.CLOUDINARY_API_KEY + ':' + env.CLOUDINARY_API_SECRET);
}

// public_id -> URL path, keeping its folder slashes.
export function idPath(id) {
  return id.split('/').map(encodeURIComponent).join('/');
}

// The Admin API record of a Live asset by public_id, image or video, with
// resource_type set; null when there's no such asset or it isn't tagged
// brg-live (so the Live token never reaches the site's other media).
// Throws on any other Cloudinary failure.
export async function lookupLive(env, id) {
  for (const type of RESOURCE_TYPES) {
    const look = await fetch(API_BASE + '/resources/' + type + '/upload/' + idPath(id), {
      headers: { Authorization: basicAuth(env) }
    });
    if (look.status === 404) continue;
    if (!look.ok) throw new Error('lookup ' + type + ' ' + look.status);
    const asset = await look.json();
    if (!Array.isArray(asset.tags) || !asset.tags.includes(LIVE_TAG)) {
      console.log('live: refused, not a Live asset:', id);
      return null;
    }
    return { ...asset, resource_type: asset.resource_type || type };
  }
  return null;
}

// image | video for a Search/Admin record (Live has nothing else).
export const typeOf = (r) => (r.resource_type === 'video' ? 'video' : 'image');
