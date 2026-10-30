// GET /geo.json — the visitor's coarse location from Cloudflare's edge
// (request.cf), so pages can show local-only content without a third-party
// geo call. Never cached: the answer is per visitor.
export function onRequestGet({ request }) {
  const cf = request.cf || {};
  const body = {
    country: cf.country || null,
    region: cf.region || null,
    city: cf.city || null
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store'
    }
  });
}
