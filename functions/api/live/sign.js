// POST /api/live/sign — signs a Blue River Live upload so the crew's phone can
// upload DIRECT to Cloudinary (the photo never passes through here).
//
//   in:  { token, params_to_sign: { timestamp?, folder, tags, context?, transformation, ... } }
//   out: { signature, api_key, cloud_name, timestamp }
//
// The client must upload with exactly the params it sent (plus the returned
// timestamp if it sent none), api_key and signature.
//
// Guardrails — refused with a 400 naming the reason (only a valid token gets
// this far, so the reason helps our own client and tells a stranger nothing):
//   - folder must be "live/" (or "live"), tags must include brg-live
//   - transformation must be exactly c_limit,w_2000,h_2000,q_auto:good (any
//     order): Live photos are stored at display size, never full-resolution
//   - only the params a Live upload uses; every value a string
//   - timestamp within an hour of now (Cloudinary's own window)
// Bad token (wrong, empty, absent, body unreadable) -> identical 403 after ~1s.
import { CLOUD_NAME, LIVE_TAG, json, missingEnv, tokenOk, forbidden, readBody, cloudinarySignature } from '../../_shared/live.js';

const REQUIRED_TRANSFORMATION = ['c_limit', 'w_2000', 'h_2000', 'q_auto:good'];
const ALLOWED_PARAMS = ['timestamp', 'folder', 'tags', 'context', 'transformation', 'public_id', 'use_filename', 'unique_filename'];
const MAX_SKEW_S = 3600;

function problem(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return 'params_to_sign must be an object';
  const unknown = Object.keys(params).filter((k) => !ALLOWED_PARAMS.includes(k));
  if (unknown.length) return 'params not allowed: ' + unknown.join(', ');
  for (const [k, v] of Object.entries(params)) {
    const ok = typeof v === 'string' || (k === 'timestamp' && typeof v === 'number');
    if (!ok) return k + ' must be a string';
  }
  if (params.folder !== 'live/' && params.folder !== 'live') return 'folder must be live/';
  const tags = String(params.tags || '').split(',').map((t) => t.trim());
  if (!tags.includes(LIVE_TAG)) return 'tags must include ' + LIVE_TAG;
  const t = String(params.transformation || '');
  const parts = t.split(',').map((p) => p.trim());
  const exact = !t.includes('/') && parts.length === REQUIRED_TRANSFORMATION.length &&
    REQUIRED_TRANSFORMATION.every((p) => parts.includes(p));
  if (!exact) return 'transformation must be ' + REQUIRED_TRANSFORMATION.join(',');
  if (params.timestamp !== undefined) {
    const ts = Number(params.timestamp);
    if (!Number.isInteger(ts) || Math.abs(ts - Date.now() / 1000) > MAX_SKEW_S) return 'timestamp must be unix seconds within an hour of now';
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const misconfigured = missingEnv(env, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'LIVE_POST_TOKEN'], 'SIGN');
  if (misconfigured) return misconfigured;

  const body = await readBody(request);
  if (!body || !(await tokenOk(body.token, env.LIVE_POST_TOKEN))) return forbidden();

  const reason = problem(body.params_to_sign);
  if (reason) return json({ error: reason }, 400);

  const params = { ...body.params_to_sign };
  if (params.timestamp === undefined) params.timestamp = Math.floor(Date.now() / 1000);
  const timestamp = Number(params.timestamp);

  return json({
    signature: await cloudinarySignature(params, env.CLOUDINARY_API_SECRET),
    api_key: env.CLOUDINARY_API_KEY,
    cloud_name: CLOUD_NAME,
    timestamp
  });
}
